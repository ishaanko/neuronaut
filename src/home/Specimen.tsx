import { useState } from "react";
import { NeuronLink } from "../neuron/parts";
import { Button, Label } from "../ui/primitives";
import { SPECIMEN_NORMAL, SPECIMEN_PROMPT, SPECIMENS } from "./specimens";

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
      <figcaption>
        <Label>One neuron, pushed too far</Label>
      </figcaption>
      <div className="mt-5 font-semibold">{SPECIMEN_PROMPT}</div>

      <div className="mt-4 text-sm text-dim">Normal</div>
      <p className="mt-1 leading-relaxed text-dim">{SPECIMEN_NORMAL}</p>

      <div className="mt-5 flex items-baseline gap-2 text-sm text-dim">
        Pushed <NeuronLink layer={s.layer} n={s.n} />
      </div>
      <p key={i} className="mt-1 text-xl leading-[1.55] sm:text-2xl">
        {parts(s.reply).map((p, j) =>
          p.hit ? (
            <mark key={j} className="infect bg-rust px-0.5 text-bg" style={{ animationDelay: `${250 + 110 * hit++}ms` }}>
              {p.text}
            </mark>
          ) : (
            <span key={j}>{p.text}</span>
          ),
        )}
        <span className="text-dim">…</span>
      </p>

      <p className="mt-5 max-w-[52ch] text-dim">
        Pushing a neuron adds its direction to the model's thinking at every word. {s.note} That's a glitch.
      </p>
      <Button variant="ghost" className="mt-4" onClick={() => setI((i + 1) % SPECIMENS.length)}>
        Another one
      </Button>
    </figure>
  );
}
