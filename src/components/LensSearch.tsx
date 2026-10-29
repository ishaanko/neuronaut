import { useQuery } from "convex/react";
import { useDeferredValue, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ChineseNote, Input, NeuronLink, Tokens } from "./ui";

// Search every neuron's steer lens (tokens a push makes likely) and logit lens. Free, and the main way to hunt.
export function LensSearch({ onPick, pickLabel = "Use" }: { onPick?: (layer: number, n: number) => void; pickLabel?: string }) {
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState("");
  const dq = useDeferredValue(q.trim());
  const dl = useDeferredValue(layer);
  const results = useQuery(api.neurons.search, dq ? { q: dq, layer: dl === "" ? undefined : Number(dl) } : "skip");
  return (
    <div>
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="a word, like ocean or doctor" className="min-w-0 flex-1" aria-label="search lenses" />
        <Input value={layer} onChange={(e) => setLayer(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="layer" className="w-20 text-center font-mono" aria-label="filter layer" />
      </div>
      {!dq && <p className="mt-2 text-sm text-dim">Lists neurons whose push makes that word more likely. Add a layer to narrow it down.</p>}
      {dq && (
        <div className="mt-2 max-h-[380px] divide-y divide-line overflow-y-auto border-y border-line">
          {results === undefined ? (
            <p className="py-3 text-sm text-dim">Searching…</p>
          ) : results.length === 0 ? (
            <p className="py-3 text-sm text-dim">No neuron's lens has that. Try a simpler word.</p>
          ) : (
            results.map((r) => (
              <div key={`${r.layer}:${r.n}`} className="flex items-center gap-3 py-2">
                <NeuronLink layer={r.layer} n={r.n} className="shrink-0" />
                <Tokens tokens={r.steer} className="min-w-0 flex-1 truncate whitespace-nowrap text-dim" />
                {onPick && (
                  <button className="press shrink-0 rounded-[3px] border border-line-strong px-2.5 py-1 text-sm hover:bg-raised" onClick={() => onPick(r.layer, r.n)}>
                    {pickLabel}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {dq && results && <ChineseNote tokens={results.flatMap((r) => r.steer)} className="mt-2" />}
    </div>
  );
}
