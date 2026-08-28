// A scraped property lists every unit at the building's single
// coordinate, and seed listings share neighborhood centroids — so pins
// are grouped: one pin per exact coordinate, carrying every listing at
// that spot (the pin label and popup present the group). Coordinates
// are never moved.

export type PinInput = { id: string; lat: number | null; lng: number | null };
export type PinGroup = { lat: number; lng: number; ids: string[] };

export function groupPins(listings: PinInput[]): PinGroup[] {
  const byCoord = new Map<string, PinGroup>();
  for (const l of listings) {
    if (l.lat === null || l.lng === null) continue;
    const key = `${l.lat},${l.lng}`;
    const group = byCoord.get(key);
    if (group) group.ids.push(l.id);
    else byCoord.set(key, { lat: l.lat, lng: l.lng, ids: [l.id] });
  }
  // Map preserves insertion order = the caller's (ranking) order.
  return [...byCoord.values()];
}
