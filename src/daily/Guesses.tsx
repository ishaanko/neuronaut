import { useState, type ReactNode } from "react";
import { LADDER_EXACT } from "../../convex/rules";
import { BehaviorMap, type Dot } from "../map/BehaviorMap";
import { dexNo } from "../neuron/format";
import { NeuronLink } from "../neuron/parts";
import { Label } from "../ui/primitives";
import { HEAT_BG, heatBand, rankText } from "./heat";
import type { Guess, Puzzle } from "./puzzle";

// A guess's heat as a filled bar (0-99, or a hit). The fill animates once, when the guess is scored.
function HeatBar({ heat, correct }: { heat: number | null; correct: boolean }) {
  const pct = correct ? 100 : heat === null ? 0 : Math.max(4, heat);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
      {heat !== null && <div className={`heat-fill h-full rounded-full ${HEAT_BG[heatBand(heat, correct)]}`} style={{ width: `${pct}%` }} />}
    </div>
  );
}

export const GUESS_GRID = "grid grid-cols-[4.75rem_1fr_2rem_3.5rem] items-center gap-2 sm:gap-3";

// One guess laid out on GUESS_GRID: its dex number, its heat as a bar and a number, and its rank among all neurons (#1
// is the closest). `pending` stands in for the bar while the guess is being measured.
export function GuessCells({ layer, n, heat, rank, correct, pending }: { layer: number; n: number; heat: number | null; rank: number | null; correct: boolean; pending?: ReactNode }) {
  return (
    <>
      <span className="font-mono text-sm">{dexNo(layer, n)}</span>
      {pending ?? <HeatBar heat={heat} correct={correct} />}
      <span className="text-right font-mono font-medium tabular-nums">{pending ? "" : correct ? "hit" : heat}</span>
      <span className="text-right font-mono text-sm tabular-nums text-dim">{pending || rank === null || correct ? "" : rankText(rank)}</span>
    </>
  );
}

// The player's guesses, hottest first. Each opens to its cosine to the answer and a link to its card.
export function GuessList({ guesses, offline }: { guesses: Guess[]; offline: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const latest = [...guesses].sort((a, b) => b.at - a.at)[0];
  return (
    <div>
      <Label className="mb-2">Guesses, hottest first</Label>
      <div className="divide-y divide-line border-y border-fg" aria-live="polite">
        {guesses.map((g) => {
          const k = `${g.layer}:${g.n}`;
          const pending = g.status === "pending" ? <span className="text-sm text-faint">{offline ? "worker offline, scores when it's back" : "measuring…"}</span> : undefined;
          return (
            <div key={k} data-guess className={g === latest ? "bg-card" : ""}>
              <button
                type="button"
                onClick={() => setOpen(open === k ? null : k)}
                aria-expanded={open === k}
                className={`${GUESS_GRID} w-full px-2 py-2.5 text-left hover:bg-card`}
              >
                <GuessCells {...g} pending={pending} />
              </button>
              {open === k && g.status === "done" && (
                <div className="px-2 pb-3 text-sm text-dim">
                  {g.correct ? (
                    "Its effect matches the answer's."
                  ) : (
                    <>
                      Cosine <span className="font-mono text-fg">{g.cos?.toFixed(3) ?? "?"}</span> to the answer.{" "}
                      {g.rank !== null && `${g.rank > LADDER_EXACT ? "About " : ""}${(g.rank - 1).toLocaleString()} neurons act more like it.`}{" "}
                    </>
                  )}
                  <NeuronLink layer={g.layer} n={g.n} className="ml-1" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The player's guesses on the behavior map, colored by heat; the answer as a green ring once the puzzle is over.
// Quiet guesses (no place) don't show.
export function GuessMap({ d }: { d: Puzzle }) {
  const dots: Dot[] = d.guesses.flatMap((g) =>
    g.place ? [{ layer: g.layer, n: g.n, ...g.place, color: g.heat === null ? "--color-raised" : `--color-${heatBand(g.heat, g.correct)}`, label: g.heat === null ? "" : `heat ${g.heat}` }] : [],
  );
  const answer = d.result?.answer;
  if (answer?.place) dots.push({ layer: answer.layer, n: answer.n, ...answer.place, color: "--color-good", ring: true, size: 7, label: "the answer" });
  return (
    <div>
      <Label className="mb-2">Your guesses on the map</Label>
      <div className="rounded-[3px] border border-line bg-card p-3">
        <BehaviorMap dots={dots} labels={false} tint={false} />
      </div>
      <p className="mt-2 text-sm text-dim">Dots use the heat colors. Neurons that act alike sit close together, so hot guesses bunch up. The map squashes a lot, so trust heat over distance.</p>
    </div>
  );
}
