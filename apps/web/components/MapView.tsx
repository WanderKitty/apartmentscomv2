"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapUnit = {
  id: string;
  propertyName: string;
  price: number | null;
  beds: number;
  baths: number;
  neighborhood: string;
};

/** One pin per exact coordinate; a building's units share a single pin. */
export type MapPin = { lat: number; lng: number; units: MapUnit[] };

export type MapBoundary = {
  name: string;
  geojson: { type: "MultiPolygon"; coordinates: number[][][][] };
};

// Orlando fallback center for the no-pins case.
const ORLANDO: [number, number] = [28.5421, -81.379];

const MAX_POPUP_UNITS = 6;

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

function pinLabel(units: MapUnit[]): string {
  const prices = units.map((u) => u.price).filter((p): p is number => p !== null);
  const min = prices.length > 0 ? dollars(Math.min(...prices)) : "$—";
  return units.length === 1 ? min : `${units.length} from ${min}`;
}

const pinHtml = (units: MapUnit[]) =>
  `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;` +
  `background:#fff;border:1px solid #c1c1c1;box-shadow:0 1px 3px rgba(0,0,0,.25);` +
  `font:600 12px/18px system-ui,sans-serif;color:#222;white-space:nowrap;">` +
  `${pinLabel(units)}</span>`;

// DOM-built popup: scraped property names must render as text, not HTML.
function popupContent(pin: MapPin): HTMLElement {
  const el = document.createElement("div");
  el.style.font = "13px/1.5 system-ui, sans-serif";
  const names = new Set(pin.units.map((u) => u.propertyName));
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent =
    names.size === 1 ? pin.units[0]!.propertyName : `${names.size} properties here`;
  el.append(title);
  // Cheapest first, so the rows start where the pin label ("N from $X") does.
  const byPrice = [...pin.units].sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  );
  for (const u of byPrice.slice(0, MAX_POPUP_UNITS)) {
    const row = document.createElement("a");
    row.href = `/listing/${encodeURIComponent(u.id)}`;
    row.style.cssText = "display:block;color:#222;margin-top:2px;text-decoration:none;";
    row.textContent =
      `${u.price === null ? "$—" : dollars(u.price)} · ` +
      `${u.beds === 0 ? "Studio" : `${u.beds} bd`} · ${u.baths} ba` +
      `${names.size > 1 ? ` · ${u.propertyName}` : ""} →`;
    el.append(row);
  }
  if (pin.units.length > MAX_POPUP_UNITS) {
    const more = document.createElement("div");
    more.style.cssText = "color:#555;margin-top:2px;";
    more.textContent = `+${pin.units.length - MAX_POPUP_UNITS} more in the list`;
    el.append(more);
  }
  return el;
}

export function MapView({ pins, boundaries }: { pins: MapPin[]; boundaries: MapBoundary[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Leaflet touches `window` at import time — load it client-side only.
      const L = (await import("leaflet")).default;
      const container = containerRef.current;
      if (cancelled || !container || mapRef.current) return;

      const map = L.map(container, { scrollWheelZoom: true, zoomControl: true });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const boundaryStyle = {
        color: "#6a6a6a",
        weight: 1.5,
        dashArray: "4 3",
        fillColor: "#6a6a6a",
        fillOpacity: 0.08,
      };
      for (const b of boundaries) L.geoJSON(b.geojson, { style: boundaryStyle }).addTo(map);

      for (const p of pins) {
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: pinHtml(p.units), className: "", iconSize: undefined }),
          title: p.units[0]!.propertyName,
        }).addTo(map);
        marker.bindPopup(popupContent(p), { closeButton: false });
      }

      const fitToContent = () => {
        if (pins.length > 0) {
          map.fitBounds(
            L.latLngBounds(pins.map((p) => [p.lat, p.lng])),
            { padding: [40, 40], maxZoom: 16 },
          );
        } else if (boundaries.length > 0) {
          const all = L.featureGroup(boundaries.map((b) => L.geoJSON(b.geojson)));
          map.fitBounds(all.getBounds(), { padding: [40, 40] });
        } else {
          map.setView(ORLANDO, 12);
        }
      };

      // The container can be display:none at init (mobile starts on the
      // list view) — Leaflet then measures a 0×0 viewport and fits wrong.
      // Defer the first fit until the container actually has a size.
      let fitted = false;
      const fitIfSized = () => {
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        map.invalidateSize();
        if (!fitted) {
          fitted = true;
          fitToContent();
        }
      };
      fitIfSized();
      const observer = new ResizeObserver(fitIfSized);
      observer.observe(container);
      observerRef.current = observer;
    })();
    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
      observerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [pins, boundaries]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-card border border-hairline"
      aria-label="Map of search results"
    />
  );
}
