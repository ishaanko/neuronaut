import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { dexNo } from "../neuron/format";
import { Replies } from "../neuron/Replies";
import { useSession } from "../players/session";
import { Label } from "../ui/primitives";
import type { Puzzle, Result } from "./puzzle";

// After a puzzle: the answer's replies next to one guess's replies on the same profile prompts, so a player can see
// what heat measured. Both cards are visible by then (the player guessed one, and finishing reveals the answer).
export function WhyHeat({ d, answer }: { d: Puzzle; answer: Result["answer"] }) {
  const [pick, setPick] = useState<string | null>(null);
  const wrong = d.guesses.filter((g) => !g.correct && g.status === "done");
  const g = wrong.find((x) => `${x.layer}:${x.n}` === pick) ?? wrong[0];
  const { guest } = useSession();
  const overview = useQuery(api.neurons.overview);
  const answerCard = useQuery(api.neurons.card, { layer: answer.layer, n: answer.n, guest });
  const guessed = useQuery(api.neurons.card, g ? { layer: g.layer, n: g.n, guest } : "skip");
  if (!g) return null;
  return (
    <section>
      <Label>Why each guess scored what it did</Label>
      <p className="mb-4 mt-1 max-w-[62ch] text-dim">
        Heat compares what two neurons do, not their numbers. Here is the answer next to one of your guesses on the same four
        questions. The more alike they read, the higher the cosine between their behavior embeddings.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {wrong.map((x) => {
          const k = `${x.layer}:${x.n}`;
          return (
            <button
              key={k}
              onClick={() => setPick(k)}
              className={`press rounded-[3px] px-3 py-1.5 font-mono text-sm ${x === g ? "bg-accent text-accent-fg" : "border border-line-strong hover:bg-raised"}`}
            >
              {dexNo(x.layer, x.n)} · {x.cos?.toFixed(2)}
            </button>
          );
        })}
      </div>
      {answerCard?.profile && guessed?.profile ? (
        <Replies
          prompts={overview?.prompts ?? []}
          steered={answerCard.profile.texts}
          steeredLabel={`The answer, ${dexNo(answer.layer, answer.n)}`}
          baseline={guessed.profile.texts}
          baselineLabel={`Your guess ${dexNo(g.layer, g.n)}: cosine ${g.cos?.toFixed(2)}, heat ${g.heat}`}
        />
      ) : (
        <p className="text-dim">Loading the answer's replies…</p>
      )}
    </section>
  );
}
