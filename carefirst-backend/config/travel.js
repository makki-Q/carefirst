// True Cost Analysis settings (decision 8 in PROJECT_GUIDE.md). Read once at startup.

const rate = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

module.exports = {
  // How the patient travels → PKR per km (one way; travel cost counts the round trip)
  TRAVEL_MODES: [
    { key: 'motorbike', label: 'Motorbike',              ratePerKm: rate(process.env.TRAVEL_RATE_MOTORBIKE, 10) },
    { key: 'car',       label: 'Car',                    ratePerKm: rate(process.env.TRAVEL_RATE_CAR, 35) },
    { key: 'ride',      label: 'Rickshaw / ride-hailing', ratePerKm: rate(process.env.TRAVEL_RATE_RIDE, 55) },
  ],
  DEFAULT_TRAVEL_MODE: 'motorbike',
  TRIPS_PER_VISIT: 2,  // there and back
  ROAD_FACTOR:     1.3, // straight-line → road estimate when routing is unavailable

  // OSRM routing service (road distance + drive time); public demo server by default
  OSRM_URL:        (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/+$/, ''),
  OSRM_TIMEOUT_MS: 6000,
};
