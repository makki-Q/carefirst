import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Leaflet's default marker looks for its images by URL, which bundlers break — point it at the imports
const pinIcon = L.icon({
  iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], shadowSize: [41, 41],
});

const PAKISTAN = { lat: 30.3753, lng: 69.3451 };

type LatLng = { lat: number; lng: number };

// OpenStreetMap with one draggable pin. Click the map or drag the pin to choose a point.
const MapPicker = ({ value, onChange, height = 280 }: { value: LatLng | null; onChange: (p: LatLng) => void; height?: number }) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pin = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pick = (p: LatLng) => onChangeRef.current({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });

  useEffect(() => {
    if (!box.current || map.current) return;
    const start = value || PAKISTAN;
    map.current = L.map(box.current).setView([start.lat, start.lng], value ? 14 : 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    map.current.on('click', (e: any) => pick(e.latlng));
    return () => { map.current?.remove(); map.current = null; pin.current = null; };
  }, []);

  // Keep the pin (and view) in step with the value
  useEffect(() => {
    if (!map.current) return;
    if (!value) { pin.current?.remove(); pin.current = null; return; }
    if (!pin.current) {
      pin.current = L.marker([value.lat, value.lng], { draggable: true, icon: pinIcon }).addTo(map.current);
      pin.current.on('dragend', () => pick(pin.current.getLatLng()));
      map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 14));
    } else {
      pin.current.setLatLng([value.lat, value.lng]);
      if (!map.current.getBounds().contains([value.lat, value.lng])) map.current.panTo([value.lat, value.lng]);
    }
  }, [value?.lat, value?.lng]);

  // Hidden tabs mount with zero size; fix the tiles once the map becomes visible
  useEffect(() => {
    if (!box.current || !('ResizeObserver' in window)) return;
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  return <div ref={box} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0, position: 'relative' }} />;
};

// Browser geolocation as a promise, with readable errors
export const currentPosition = () => new Promise<LatLng>((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('This browser cannot share your location. Drop a pin on the map instead.'));
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
    err => reject(new Error(err.code === 1
      ? 'Location permission was denied. Allow it in the browser, or drop a pin on the map instead.'
      : 'Could not get your location. Drop a pin on the map instead.')),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
});

export default MapPicker;
