import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import type { Hotel } from '../types/station';
import { formatConnectors, formatPorts, timeSince } from '../utils/filters';

// Brand → accent color
const BRAND_COLORS: Record<string, string> = {
  'Cambria': '#1a3a5c',
  'Radisson': '#c8102e',
  'Radisson Blu': '#0057a8',
  'Radisson Red': '#e4002b',
  'Country Inn & Suites': '#5b2d82',
  'Comfort Inn': '#f47920',
  'Comfort Suites': '#f47920',
  'Quality Inn': '#005c9c',
  'Quality Suites': '#005c9c',
  'Sleep Inn': '#00a650',
  'Clarion': '#8b0000',
  'Clarion Pointe': '#8b0000',
  'Econo Lodge': '#006747',
  'Rodeway Inn': '#8b4513',
  'MainStay Suites': '#0078a0',
  'WoodSpring Suites': '#4e7a38',
  'Ascend Collection': '#333333',
};

function brandColor(brand: string): string {
  return BRAND_COLORS[brand] ?? '#2563eb';
}

function makeIcon(brand: string, hasEV: boolean): L.DivIcon {
  const color = hasEV ? brandColor(brand) : '#4a4f5e';
  const initial = brand.charAt(0).toUpperCase();
  const opacity = hasEV ? '1' : '0.55';
  const border = hasEV ? 'white' : '#8b90a0';
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:32px;height:32px;border-radius:50% 50% 50% 0;
        background:${color};border:2.5px solid ${border};
        display:flex;align-items:center;justify-content:center;
        transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        opacity:${opacity};
      ">
        <span style="
          transform:rotate(45deg);color:white;
          font-size:13px;font-weight:700;
          font-family:'DM Sans',sans-serif;
          line-height:1;
        ">${initial}</span>
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  });
}

function popupHtml(h: Hotel): string {
  const color = h.hasEV ? brandColor(h.brand) : '#4a4f5e';
  const addressLine = [h.address, h.city, h.state && h.zip ? `${h.state} ${h.zip}` : h.state || h.zip]
    .filter(Boolean)
    .join(', ') || `${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`;
  const mapsQuery = h.address
    ? encodeURIComponent(`${h.name}, ${h.address}, ${h.city}, ${h.state} ${h.zip}`)
    : encodeURIComponent(`${h.name} ${h.lat},${h.lng}`);

  const evSection = h.hasEV ? `
    <div class="ev-popup-ev-badge">⚡ EV Charging Available</div>
    <table class="ev-popup-table">
      <tr><td>Ports</td><td>${formatPorts(h)}</td></tr>
      ${h.connectors.length ? `<tr><td>Connectors</td><td>${formatConnectors(h.connectors)}</td></tr>` : ''}
      ${h.evHours ? `<tr><td>Hours</td><td>${h.evHours}</td></tr>` : ''}
      ${h.evPricing ? `<tr><td>Pricing</td><td>${h.evPricing}</td></tr>` : ''}
      ${h.evNetwork ? `<tr><td>Network</td><td>${h.evNetwork}</td></tr>` : ''}
      ${h.evLastConfirmed ? `<tr><td>Confirmed</td><td>${timeSince(h.evLastConfirmed)}</td></tr>` : ''}
      ${h.evUpdatedAt ? `<tr><td>Updated</td><td>${timeSince(h.evUpdatedAt)}</td></tr>` : ''}
    </table>` : `
    <div class="ev-popup-no-ev">No EV charging on record</div>`;

  return `
    <div class="ev-popup">
      <div class="ev-popup-header" style="background:${color}">
        <span class="ev-popup-brand">${h.brand}</span>
      </div>
      <div class="ev-popup-body">
        <div class="ev-popup-name">${h.name}</div>
        <div class="ev-popup-addr">${addressLine}</div>
        ${evSection}
        <a class="ev-popup-directions" href="https://maps.google.com/?q=${mapsQuery}" target="_blank" rel="noopener">
          ↗ Get Directions
        </a>
      </div>
    </div>`;
}

interface MapProps {
  hotels: Hotel[];
}

export default function Map({ hotels }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Force Leaflet to recalculate container dimensions after layout paints
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current!);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when hotels change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction(c) {
        const count = c.getChildCount();
        const size = count < 10 ? 36 : count < 50 ? 42 : 50;
        return L.divIcon({
          html: `<div class="cluster-icon" style="width:${size}px;height:${size}px;line-height:${size}px">${count}</div>`,
          className: '',
          iconSize: [size, size],
        });
      },
    });

    hotels.forEach((h) => {
      const marker = L.marker([h.lat, h.lng], { icon: makeIcon(h.brand, h.hasEV) });
      marker.bindPopup(popupHtml(h), { maxWidth: 300, className: 'ev-popup-wrapper' });
      cluster.addLayer(marker);
    });

    cluster.addTo(map);
    clusterRef.current = cluster;
  }, [hotels]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
