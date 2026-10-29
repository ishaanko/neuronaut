import { useState } from "react";
import { SPECIMEN_NORMAL, SPECIMEN_PROMPT, SPECIMENS } from "../data/specimens";
import { Label, NeuronLink, RarityTag } from "./ui";

// "{sd}" spans in a specimen's reply: what the push wrote over it.
function parts(reply: string) {
  return reply.split(/(\{[^}]*\})/).filter(Boolean).map((p) => (p.startsWith("{") ? { text: p.slice(1, -1), hit: true } : { text: p, hit: false }));
}

// The homepage's hook: a destructive neuron's reply under the normal one, with what the push wrote over it marked in
// rust. The marks come in one after another, once, each time a specimen shows. "Another one" cycles through them.
export function Specimen() {
  const [i, setI] = useState(() => Math.floor(Math.random() * SPECIMENS.length));
  const s = SPECIMENS[i];
  let hit = 0;
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-4">
        <Label>One neuron, pushed too far</Label>
        <RarityTag rarity="glitch" />
      </figcaption>
      <div className="mt-5 font-semibold">{SPECIMEN_PROMPT}</div>

      <div className="mt-4 font-mono text-[11px] uppercase tracking-wider text-faint">Normal</div>
      <p className="mt-1 text-[15px] leading-relaxed text-dim">{SPECIMEN_NORMAL}</p>

      <div className="mt-5 flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-wider text-faint">
        Pushed <NeuronLink layer={s.layer} n={s.n} className="normal-case tracking-normal" />
      </div>
      <p key={i} className="mt-1 text-xl leading-[1.55] sm:text-2xl">
        {parts(s.reply).map((p, j) =>
          p.hit ? (
            <mark key={j} className="infect rounded-[2px] bg-rust px-0.5 text-card" style={{ animationDelay: `${250 + 110 * hit++}ms` }}>
              {p.text}
            </mark>
          ) : (
            <span key={j}>{p.text}</span>
          ),
        )}
        <span className="text-faint">…</span>
      </p>

      <p className="mt-5 max-w-[52ch] text-[15px] text-dim">
        Pushing a neuron adds its direction to the model's thinking at every word. {s.note} That's a glitch.
      </p>
      <button
        onClick={() => setI((i + 1) % SPECIMENS.length)}
        className="press mt-4 h-10 rounded-[3px] border border-fg px-4 font-mono text-sm font-medium hover:bg-raised"
      >
        Another one
      </button>
    </figure>
  );
}
