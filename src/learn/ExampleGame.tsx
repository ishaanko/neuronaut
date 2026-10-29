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
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-dim">
          Daily #{EXAMPLE.number} · step {i + 1} of {steps.length}
        </span>
        <div className="flex gap-1" aria-hidden>
          {steps.map((_, j) => (
            <span key={j} className={`h-1 w-5 rounded-full ${j <= i ? "bg-fg" : "bg-line-strong"}`} />
          ))}
        </div>
      </div>

      <p className="mt-3 min-h-[4.5rem] text-[16px] leading-relaxed" aria-live="polite">
        {step.say}
      </p>

      <div className="mt-4 space-y-4">
        {i === 0 && (
          <div className="divide-y divide-line rounded-[3px] border border-line">
            {EXAMPLE.clues.map((c) => (
              <div key={c.prompt} className="p-4">
                <div className="text-sm font-semibold">{c.prompt}</div>
                <Reply text={c.reply} className="mt-1.5 text-dim" />
              </div>
            ))}
          </div>
        )}

        {step.search && (
          <div className="rounded-[3px] border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 font-mono text-sm">
              <span className="text-dim">search</span>
              <span>{step.search.q}</span>
              {step.search.layer !== undefined && <span className="ml-auto text-dim">layer {step.search.layer}</span>}
            </div>
            <ul>
              {step.search.hits.map((h) => {
                const picked = step.search!.pick === `${h.layer}:${h.n}`;
                return (
                  <li key={`${h.layer}:${h.n}`} className={`flex items-center gap-3 px-3 py-2 ${picked ? "bg-raised" : ""}`}>
                    <span className="w-[4.5rem] shrink-0 font-mono text-sm">{dexNo(h.layer, h.n)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-dim">{h.steer.join("  ")}</span>
                    {picked && <span className="shrink-0 text-xs font-medium">guessed</span>}
                  </li>
                );
              })}
            </ul>
            <ChineseNote tokens={step.search.hits.flatMap((h) => h.steer)} className="border-t border-line px-3 py-2" />
          </div>
        )}

        {guesses.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-dim">Guesses so far: heat, then rank among all neurons (#1 is the closest)</div>
            {guesses.map((g, j) => (
              <div key={j} className={`${GUESS_GRID} rounded-[3px] px-2 py-2 ${j === guesses.length - 1 && step.guess ? "bg-raised" : ""}`}>
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
