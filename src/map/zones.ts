import zones from "./zones.json";

// The behavior map's layout (worker/places.py writes zones.json): a GRID x GRID board of squares, each in a zone or
// empty, and how many neurons were strong enough to place. The rest barely change anything pushed alone ("quiet").
export const ZONES = zones.zones;
export const GRID = zones.grid;
export const PLACED = zones.placed;
export const QUIET_SHARE = 1 - zones.placed / zones.total;

const TINT: Record<string, string> = {
  silence: "#8a8a8a",
  stutter: "#d16ba5",
  derail: "#c2410c",
  tone: "#0ea5e9",
  self: "#8b5cf6",
  drift: "#14b8a6",
  rewrite: "#eab308",
  words: "#22c55e",
  phrase: "#f97316",
  loop: "#ef4444",
};
export const zoneTint = (id: string) => TINT[id] ?? "#888";

// The zone a square of the board belongs to, or null for an empty square.
export const zoneAt = (cell: number) => {
  const ch = zones.cells[cell];
  return ch && ch !== "." ? ZONES[ch.charCodeAt(0) - 97] : null;
};
