import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { LIMITS } from "../../convex/rules";
import { useUnlock } from "../learn/fieldNotes";
import { dexNo } from "../neuron/format";
import { DoseInput, NeuronInput, NeuronLink } from "../neuron/parts";
import { Replies } from "../neuron/Replies";
import { useSession } from "../players/session";
import { errorText } from "../ui/errors";
import { Panel } from "../ui/Plate";
import { Button, ErrorLine, Label, PageTitle, Stat } from "../ui/primitives";

type Slot = { layer: string; n: string; dose: string };
const empty: Slot = { layer: "", n: "", dose: "0.6" };

// How an experiment came out, in words. additivity: cosine between the joint change and the sum of the two; gain: the
// joint change's size over the sum's. Calibrated on real runs: small doses land near 0.997, a dose of 1.0 near 0.9.
function verdict(additivity: number, gain: number) {
  const size =
    gain < 0.85
      ? " Together they come out weaker than the sum: both push the same way, and the effect saturates."
      : gain > 1.15
        ? " Together they come out stronger than the sum."
        : "";
  if (additivity >= 0.98)
    return { title: "They add up", body: "The pair changes the model's last layer by almost exactly the sum of the two. Up close, the network is nearly linear." + size };
  if (additivity >= 0.9) return { title: "Mostly add up", body: "Close to the sum, bent a little by the layers in between." + size };
  return { title: "They interfere", body: "The layers after the pushes bend the sum into something else." + size };
}

export function Lab() {
  const { me, requireJoin } = useSession();
  const mine = useQuery(api.lab.mine, {});
  const seen = useQuery(api.map.mine, {});
  const overview = useQuery(api.neurons.overview);
  const run = useMutation(api.lab.run);
  const [slots, setSlots] = useState<[Slot, Slot]>([empty, empty]);
  const [error, setError] = useState<string | null>(null);
  useUnlock("combine", !!mine?.some((e) => e.status === "done"));

  const set = (i: 0 | 1, patch: Partial<Slot>) => setSlots((s) => (i === 0 ? [{ ...s[0], ...patch }, s[1]] : [s[0], { ...s[1], ...patch }]));
  const go = async () => {
    setError(null);
    if (!(await requireJoin())) return;
    if (slots.some((s) => s.layer === "" || s.n === "")) return setError("Fill in both neurons");
    const [a, b] = slots.map((s) => ({ layer: Number(s.layer), n: Number(s.n), dose: Number(s.dose) }));
    try {
      await run({ a, b });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const fill = (layer: number, n: number) => set(slots[0].layer === "" ? 0 : 1, { layer: String(layer), n: String(n) });

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageTitle>Lab</PageTitle>
        <p className="max-w-[70ch] text-dim">
          Push two neurons at once and see if their effects add up. The model reads the same normal replies three times: with
          each push alone, then with both. If the pair does exactly the sum of the two, the network is acting linearly. If not,
          the layers in between bent it. {LIMITS.experiments} experiments a day.
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-6">
          {mine === undefined ? null : mine.length === 0 ? (
            <p className="rounded-[3px] border border-line p-6 text-dim">
              No experiments yet. A good first run: one pair at a small dose, then the same pair at 1.0. Then try two neurons that
              push the same word.
            </p>
          ) : (
            mine.map((e) => {
              const r = e.result;
              const v = !r
                ? null
                : r.faint
                  ? { title: "Too faint to tell", body: "One of these barely changes anything alone, so there is little to add up and the numbers are mostly noise. Try two stronger neurons." }
                  : verdict(r.additivity, r.gain);
              return (
                <article key={e.id} className="rounded-[3px] border border-line bg-card p-6">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    <NeuronLink layer={e.a.layer} n={e.a.n} /> ×{e.a.dose} <span className="text-dim">+</span>
                    <NeuronLink layer={e.b.layer} n={e.b.n} /> ×{e.b.dose}
                  </div>
                  {e.status === "pending" && <p className="mt-3 text-dim">Running the model…</p>}
                  {e.status === "failed" && <p className="mt-3 text-glitch">The run failed. Try again.</p>}
                  {r && v && (
                    <>
                      <div className="mt-3 text-2xl font-semibold">{v.title}</div>
                      <p className="text-dim">{v.body}</p>
                      <div className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
                        <Stat label="Additivity" value={r.additivity.toFixed(3)} sub="cosine with the sum" />
                        <Stat label="Size" value={`${r.gain.toFixed(2)}×`} sub="of the sum" />
                        <Stat label={`Like ${dexNo(e.a.layer, e.a.n)}`} value={r.towardA.toFixed(2)} sub="cosine" />
                        <Stat label={`Like ${dexNo(e.b.layer, e.b.n)}`} value={r.towardB.toFixed(2)} sub="cosine" />
                      </div>
                      {r.texts.length > 0 && (
                        <div className="mt-5">
                          <Replies prompts={overview?.prompts ?? []} steered={r.texts} steeredLabel="Both pushed" baseline={overview?.baseline} />
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })
          )}
        </section>

        <aside className="order-first space-y-6 lg:order-none lg:sticky lg:top-20 lg:self-start">
          <Panel ascii="lab" className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <Label>Your two neurons</Label>
            {([0, 1] as const).map((i) => (
              <div key={i} className="mt-3 flex flex-wrap items-end gap-2">
                <span className="flex h-11 w-5 items-center font-medium text-dim">{i ? "B" : "A"}</span>
                <NeuronInput layer={slots[i].layer} n={slots[i].n} onLayer={(v) => set(i, { layer: v })} onN={(v) => set(i, { n: v })} />
                <DoseInput value={slots[i].dose} onChange={(v) => set(i, { dose: v })} label={`dose ${i ? "B" : "A"}`} />
              </div>
            ))}
            <Button size="lg" className="mt-4 w-full">
              Run
            </Button>
            <div className="mt-2 min-h-5">
              <ErrorLine error={error} />
            </div>
          </form>
          </Panel>
          {me && seen && seen.length > 0 && (
            <div>
              <Label className="mb-2">Neurons you've seen</Label>
              <div className="flex flex-wrap gap-2">
                {seen.slice(0, 18).map((s) => (
                  <button key={`${s.layer}:${s.n}`} onClick={() => fill(s.layer, s.n)} className="press rounded-[3px] border border-line-strong px-2.5 py-1.5 font-mono text-sm hover:bg-raised">
                    {dexNo(s.layer, s.n)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
