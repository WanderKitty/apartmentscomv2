"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

// Rausch teardrop pin, dropped in with a small settle animation (the
// keyframes live in globals.css and are disabled under reduced motion).
const PIN_HTML = `
<div class="pin-drop" aria-hidden="true">
  <svg width="36" height="44" viewBox="0 0 36 44" fill="none">
    <path d="M18 1C9.2 1 2 8.1 2 16.9 2 28.4 18 43 18 43s16-14.6 16-26.1C34 8.1 26.8 1 18 1Z"
          fill="#ff385c" stroke="#ffffff" stroke-width="2"/>
    <circle cx="18" cy="16.5" r="5.5" fill="#ffffff"/>
  </svg>
</div>`;

/**
 * Leaflet mini-map with a single pin. Loaded entirely on the client —
 * Leaflet is imported lazily so it never blocks first paint; the shimmer
 * underneath shows until the map's first tiles are ready. Scroll-wheel
 * zoom stays off so the page never hijacks scrolling.
 */
export function MiniMap({
  latitude,
  longitude,
  propertyName,
}: {
  latitude: number;
  longitude: number;
  propertyName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
        maxZoom: 16, // the Esri canvas basemap tops out at 16
      }).setView([latitude, longitude], 15);
      // Esri's light-gray canvas: key-free, and its quiet palette matches
      // the design system (CARTO's basemaps now require an API key).
      const esri =
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_{layer}/MapServer/tile/{z}/{y}/{x}";
      const base = L.tileLayer(esri.replace("{layer}", "Base"), {
        attribution: "Tiles &copy; Esri",
        maxZoom: 16,
      }).addTo(map);
      L.tileLayer(esri.replace("{layer}", "Reference"), { attribution: "", maxZoom: 16 }).addTo(map);
      L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: "", // no default leaflet icon styles
          html: PIN_HTML,
          iconSize: [36, 44],
          iconAnchor: [18, 42],
        }),
        keyboard: false,
      }).addTo(map);
      // 'load' = every visible base tile painted; the skeleton drops then.
      base.once("load", () => {
        if (!cancelled) setReady(true);
      });
    })().catch(() => {
      // Leaflet chunk failed to load (offline, blocked CDN): stop the
      // shimmer and say so instead of spinning forever.
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude, propertyName]);

  if (failed) {
    return (
      <div className="flex h-64 items-center justify-center rounded-card border border-hairline-soft bg-surface-soft md:h-72">
        <p className="text-[13px] text-muted">Map couldn’t load.</p>
      </div>
    );
  }

  return (
    <div className="relative isolate z-0 h-64 overflow-hidden rounded-card border border-hairline-soft md:h-72">
      {!ready && <div className="absolute inset-0 skeleton" aria-hidden />}
      {/* The opacity transition lives on this wrapper: Leaflet appends its
          own classes to the mount div below, so React must never rewrite
          that element's className after mount. */}
      <div
        role="region"
        aria-label={`Map showing the location of ${propertyName}`}
        className={`size-full transition-opacity duration-[var(--duration-entrance)] ${ready ? "opacity-100" : "opacity-0"}`}
      >
        <div ref={containerRef} className="size-full" />
      </div>
    </div>
  );
}
