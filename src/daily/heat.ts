import { LADDER_EXACT } from "../../convex/rules";

// A scored guess's heat band, Wordle-style: cold (grey), warm (yellow), warmer (orange), hot (red), or a hit (good,
// green). Each band is a theme color of the same name (index.css), used for fills only: the yellow isn't readable as text.
export type HeatBand = "cold" | "warm" | "warmer" | "hot" | "good";

export function heatBand(heat: number, correct = false): HeatBand {
  if (correct) return "good";
  if (heat >= 70) return "hot";
  if (heat >= 45) return "warmer";
  if (heat >= 20) return "warm";
  return "cold";
}

// Tailwind only ships classes it finds written out whole.
export const HEAT_BG: Record<HeatBand, string> = { cold: "bg-cold", warm: "bg-warm", warmer: "bg-warmer", hot: "bg-hot", good: "bg-good" };

// The share grid's square for each band.
export const HEAT_EMOJI: Record<HeatBand, string> = { cold: "⬛", warm: "🟨", warmer: "🟧", hot: "🟥", good: "🟩" };

// A daily guess's rank: exact inside the ladder's exact region, rounded past it (it's interpolated there).
export function rankText(rank: number) {
  if (rank <= LADDER_EXACT) return `#${rank}`;
  return `~#${rank < 10_000 ? (rank / 1000).toFixed(1) : Math.round(rank / 1000)}k`;
}
