import type { Rarity } from "../../convex/rules";

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

// A reply as one plain line, for previews too small for Reply: heading, bullet and bold markers dropped.
export function plainReply(text: string) {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .join(" ");
}
