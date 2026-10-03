const { OSRM_URL, OSRM_TIMEOUT_MS, ROAD_FACTOR } = require('../config/travel');

const isLatLng = (p) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

// Great-circle distance in km
const haversineKm = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// Straight line × ROAD_FACTOR, ~40 km/h — used when OSRM can't route
const approximate = (origin, dest) => {
  const km = haversineKm(origin, dest) * ROAD_FACTOR;
  return { distanceKm: km, durationMin: (km / 40) * 60, source: 'approx' };
};

const BATCH = 50; // destinations per OSRM table request

// Road distance + drive time from `origin` to each destination (same order).
// One OSRM "table" request per batch; anything OSRM can't route is approximated.
const routeDistances = async (origin, destinations) => {
  const results = destinations.map(d => approximate(origin, d));

  for (let start = 0; start < destinations.length; start += BATCH) {
    const batch = destinations.slice(start, start + BATCH);
    const coords = [origin, ...batch].map(p => `${p.lng},${p.lat}`).join(';');
    try {
      const res = await fetch(`${OSRM_URL}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`, {
        signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
        headers: { 'User-Agent': 'CareFirst-FYP/1.0' },
      });
      const data = await res.json();
      if (!res.ok || data.code !== 'Ok') continue;
      batch.forEach((_, i) => {
        const meters  = data.distances?.[0]?.[i + 1];
        const seconds = data.durations?.[0]?.[i + 1];
        if (Number.isFinite(meters) && Number.isFinite(seconds)) {
          results[start + i] = { distanceKm: meters / 1000, durationMin: seconds / 60, source: 'road' };
        }
      });
    } catch {
      // network error / timeout → keep the approximations for this batch
    }
  }
  return results;
};

module.exports = { isLatLng, haversineKm, routeDistances };
