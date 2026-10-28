import { LADDER_EXACT, type Rarity } from "../../convex/rules";

export const RARITY_COLOR: Record<Rarity, string> = {
  legendary: "text-legendary",
  epic: "text-epic",
  rare: "text-rare",
  uncommon: "text-uncommon",
  common: "text-common",
  glitch: "text-glitch",
};

// "14·2742": layer and neuron, the dex number.
export function dexNo(layer: number, n: number) {
  return `${String(layer).padStart(2, "0")}·${String(n).padStart(4, "0")}`;
}

export function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function until(ms: number) {
  const s = Math.max(0, (ms - Date.now()) / 1000);
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

// Heat as a fill color, Wordle-style: grey (cold), yellow, orange, red (hot), green for a hit. Fills only: the light
// yellow isn't readable as text.
export function heatBg(heat: number | null, correct = false) {
  if (correct) return "bg-good";
  if (heat === null) return "bg-raised";
  if (heat >= 70) return "bg-hot";
  if (heat >= 45) return "bg-warmer";
  if (heat >= 20) return "bg-warm";
  return "bg-cold";
}

// The same color as a theme variable, for canvases (the behavior map's dots).
export function heatVar(heat: number | null, correct = false) {
  return "--color-" + heatBg(heat, correct).slice(3);
}

// The share grid's emoji for one guess, matching heatBg.
export function heatEmoji(heat: number, correct: boolean) {
  return correct ? "🟩" : heat >= 70 ? "🟥" : heat >= 45 ? "🟧" : heat >= 20 ? "🟨" : "⬛";
}

// A daily guess's rank: exact inside the ladder's exact region, rounded past it (it's interpolated there).
export function rankText(rank: number) {
  if (rank <= LADDER_EXACT) return `#${rank}`;
  return `~#${rank < 10_000 ? (rank / 1000).toFixed(1) : Math.round(rank / 1000)}k`;
}

// Seconds as m:ss (or h:mm:ss past an hour), for the daily's solve clock.
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
