"use client";

import { useState, type ReactNode } from "react";
import { MapView, type MapPin, type MapBoundary } from "./MapView";

/**
 * Split view: list + sticky map side by side on lg+, a List ⇄ Map toggle
 * below that. The list stays server-rendered and arrives as children.
 */
export function ResultsSplit({
  pins,
  boundaries,
  children,
}: {
  pins: MapPin[];
  boundaries: MapBoundary[];
  children: ReactNode;
}) {
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-6">
      <div className="mb-3 flex justify-end lg:hidden">
        <div className="inline-flex overflow-hidden rounded-full border border-hairline text-[13px]">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setMobileView(v)}
              className={
                mobileView === v
                  ? "bg-ink px-4 py-1.5 font-semibold text-white"
                  : "px-4 py-1.5 text-body"
              }
            >
              {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      <div className={mobileView === "map" ? "hidden lg:block" : ""}>{children}</div>

      <div
        className={
          mobileView === "map"
            ? "h-[70vh] lg:h-auto"
            : "hidden lg:block"
        }
      >
        <div className="h-full lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <MapView pins={pins} boundaries={boundaries} />
        </div>
      </div>
    </div>
  );
}
