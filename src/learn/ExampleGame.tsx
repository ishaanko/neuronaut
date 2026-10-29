import { useState, type ReactNode } from "react";
import { GUESS_GRID, GuessCells } from "../daily/Guesses";
import { dexNo } from "../neuron/format";
import { ChineseNote } from "../neuron/parts";
import { Reply } from "../neuron/Replies";
import { Button } from "../ui/primitives";
import { EXAMPLE } from "./example";

// Daily #1 played out a step at a time: what the player read, searched and guessed, and what each guess scored.
// Nothing moves by itself; Back and Next step through it. `end` replaces Next on the last step.
export function ExampleGame({ end }: { end?: ReactNode }) {
  const [i, setI] = useState(0);
  const steps = EXAMPLE.steps;
  const step = steps[i];
  const guesses = steps.slice(0, i + 1).flatMap((s) => (s.guess ? [s.guess] : []));
  const last = i === steps.length - 1;

  return (
    <div>
      <div className="text-sm text-dim">
        Daily #{EXAMPLE.number}, step {i + 1} of {steps.length}
      </div>

      <p className="mt-2 min-h-[4.5rem] leading-relaxed" aria-live="polite">
        {step.say}
      </p>

      <div className="mt-4 space-y-6">
        {i === 0 && (
          <div className="space-y-4">
            {EXAMPLE.clues.map((c) => (
              <div key={c.prompt}>
                <div className="font-semibold">{c.prompt}</div>
                <Reply text={c.reply} className="mt-1.5 text-dim" />
              </div>
            ))}
          </div>
        )}

        {step.search && (
          <div>
            <div className="text-sm text-dim">
              Searching “{step.search.q}”{step.search.layer !== undefined && ` in layer ${step.search.layer}`}
            </div>
            <ul className="mt-1">
              {step.search.hits.map((h) => {
                const picked = step.search!.pick === `${h.layer}:${h.n}`;
                return (
                  <li key={`${h.layer}:${h.n}`} className="flex items-center gap-3 py-1">
                    <span className={`w-[4.5rem] shrink-0 font-mono text-sm ${picked ? "text-rust" : ""}`}>{dexNo(h.layer, h.n)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-dim">{h.steer.join("  ")}</span>
                    {picked && <span className="shrink-0 text-sm text-rust">guessed</span>}
                  </li>
                );
              })}
            </ul>
            <ChineseNote tokens={step.search.hits.flatMap((h) => h.steer)} className="mt-2" />
          </div>
        )}

        {guesses.length > 0 && (
          <div>
            <div className="mb-1 text-sm text-dim">Guesses so far: heat, then rank among all neurons (#1 is the closest)</div>
            {guesses.map((g, j) => (
              <div key={j} className={`${GUESS_GRID} py-1.5`}>
                <GuessCells {...g} correct={!!g.correct} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="ghost" onClick={() => setI(i - 1)} disabled={i === 0}>
          Back
        </Button>
        {last ? (
          end
        ) : (
          <Button className="flex-1" onClick={() => setI(i + 1)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
