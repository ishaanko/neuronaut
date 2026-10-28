import { ConvexError } from "convex/values";

// Game rules, shared by the client and the server (no server imports here).
export const MODEL = { name: "Qwen3.5-4B", id: "Qwen/Qwen3.5-4B", layers: 32, width: 9216 };
export const LIMITS = { scans: 12, catches: 3, guesses: 15, entries: 8, experiments: 5 };
// GPU budget: jobs one player can have waiting at once, and players' jobs waiting in total before new ones are refused.
// Guests queue at their own priority (jobs.ts GUEST_PRIORITY) under their own, smaller total: anyone can mint guest
// tokens, so guests can crowd out other guests but never players with accounts. `waiters`: guesses that may wait on one
// unmeasured neuron before guests' are refused, so the worker can score them all in one mutation.
export const GPU = { perPlayer: 4, queue: 200, guests: 50, waiters: 100 };
export const HINTS = { band: 5, token: 10 }; // daily hints unlock after this many guesses
export const SOLVE_COS = 0.97; // a guess this similar to the answer counts as solving it
export const LAUNCH = "2026-10-27";

// What pushing a neuron does, from worker/places.py. Players predict it before a scan. "quiet": barely changes the
// output; "shift": changes tone or topic without its steer-lens tokens showing up; "word": its top steer-lens tokens
// show up in the replies; "breaks": the text falls apart.
export const EFFECTS = ["quiet", "shift", "word", "breaks"] as const;
export type Effect = (typeof EFFECTS)[number];
export const PREDICT_POINTS = 2;

export const RARITIES = ["legendary", "epic", "rare", "uncommon", "common", "glitch"] as const;
export type Rarity = (typeof RARITIES)[number];
export const POINTS: Record<Rarity, number> = { legendary: 100, epic: 30, rare: 10, uncommon: 3, common: 1, glitch: 5 };

// Strength z against random directions. From a 2048-neuron calibration (64 per layer), among coherent neurons about
// 0.4% are legendary, 2% epic, 6% rare and 20% uncommon. A push that wrecks the text is a glitch: high NLL under the
// unsteered model, or any reply that loops or comes back empty (worst prompt's distinct-2 under 0.5). Glitches are
// common among the strongest pushes, and worth a little.
const Z = { legendary: 12, epic: 7, rare: 3.5, uncommon: 1.5 };
export const GLITCH = { nll: 3.2, distinct: 0.5 };

export function rarity(z: number, nll: number, distinct: number): Rarity {
  if (nll > GLITCH.nll || distinct < GLITCH.distinct) return "glitch";
  if (z >= Z.legendary) return "legendary";
  if (z >= Z.epic) return "epic";
  if (z >= Z.rare) return "rare";
  if (z >= Z.uncommon) return "uncommon";
  return "common";
}

export const neuronKey = (layer: number, n: number) => `${layer}:${n}`;

export function validNeuron(layer: number, n: number) {
  if (!Number.isInteger(layer) || !Number.isInteger(n) || layer < 0 || layer >= MODEL.layers || n < 0 || n >= MODEL.width)
    throw new ConvexError(`no neuron L${layer} N${n}: layers 0-${MODEL.layers - 1}, neurons 0-${MODEL.width - 1}`);
}

export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  return today(Date.parse(date + "T00:00:00Z") + days * 86400000);
}

export function dailyNumber(date: string) {
  return Math.round((Date.parse(date) - Date.parse(LAUNCH)) / 86400000) + 1;
}

export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // both unit length
}

// Daily ranks. The worker samples how close every measured neuron is to the answer (worker/store.py `ladder`): every
// cosine down to rank LADDER_EXACT, then one per power of two, then the farthest.
export const LADDER_EXACT = 1024;
export type Ladder = { ranks: number[]; cos: number[] };

// Where a guess with this cosine to the answer sits among all measured neurons (1 = closest). Exact inside the top
// LADDER_EXACT; past that, interpolated on a log scale between the two ladder points around it.
export function ladderRank({ ranks, cos }: Ladder, c: number): number {
  const above = cos.filter((x) => x > c).length; // cos is sorted high to low
  if (above === 0) return 1;
  if (above === cos.length) return ranks[ranks.length - 1];
  const [ra, rb, ca, cb] = [ranks[above - 1], ranks[above], cos[above - 1], cos[above]];
  if (rb - ra === 1) return rb;
  const t = ca === cb ? 1 : (ca - c) / (ca - cb);
  return Math.round(Math.exp(Math.log(ra) + t * (Math.log(rb) - Math.log(ra))));
}

// 0-99 from a rank among `total` neurons, on a log scale: a random guess is about 5, the top 500 about 50, the closest
// wrong guess 99. A correct guess shows as a hit, not a heat.
export function heat(rank: number, total: number): number {
  if (total <= 1) return 99;
  return Math.max(0, Math.min(99, Math.round(100 * (1 - Math.log(rank) / Math.log(total)))));
}
