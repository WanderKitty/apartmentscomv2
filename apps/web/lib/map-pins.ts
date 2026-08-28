// Seed listings in one neighborhood share the neighborhood-centroid
// coordinate, which would stack their map pins invisibly. Spread exact
// collisions in a small deterministic ring (~110m); unique coordinates
// pass through untouched, so real per-property coords are never moved.

const RING_RADIUS_DEG = 0.001;

export type PinInput = { id: string; lat: number | null; lng: number | null };
export type Pin = { id: string; lat: number; lng: number };

export function pinPositions(listings: PinInput[]): Pin[] {
  const groups = new Map<string, PinInput[]>();
  const located = listings.filter((l): l is PinInput & Pin => l.lat !== null && l.lng !== null);
  for (const l of located) {
    const key = `${l.lat},${l.lng}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const spread = new Map<string, Pin>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      const [l] = group as Pin[];
      spread.set(l!.id, { id: l!.id, lat: l!.lat, lng: l!.lng });
      continue;
    }
    const ordered = [...(group as Pin[])].sort((a, b) => a.id.localeCompare(b.id));
    ordered.forEach((l, i) => {
      const angle = (2 * Math.PI * i) / ordered.length;
      spread.set(l.id, {
        id: l.id,
        lat: l.lat + RING_RADIUS_DEG * Math.sin(angle),
        lng: l.lng + RING_RADIUS_DEG * Math.cos(angle),
      });
    });
  }
  // Preserve the caller's (ranking) order.
  return located.map((l) => spread.get(l.id)!);
}
