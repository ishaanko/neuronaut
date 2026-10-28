import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LensSearch } from "../components/LensSearch";
import { Button, ErrorLine, Input, Label, NeuronInput, NeuronLink, Panel, ScrollX } from "../components/ui";
import { Reply } from "../components/Replies";
import { until } from "../lib/format";
import { useNotes } from "../lib/notes";
import { errorText, useSession } from "../lib/session";

export function Bounties() {
  const list = useQuery(api.bounties.list);
  const groups = (["open", "upcoming", "closed"] as const).map((st) => [st, (list ?? []).filter((b) => b.state === st)] as const);
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Bounties<span className="text-rust">.</span></h1>
        <p className="max-w-[70ch] text-dim">
          Each bounty asks you to steer the model somewhere, like into French or onto the sea. Pick up to a few neurons and how
          hard to push each. A judge scores the replies on hidden prompts. Beat the house's par and finish in the top three to
          win points.
        </p>
      </div>
      {list === undefined && <p className="py-10 text-center text-dim">Loading bounties…</p>}
      {groups.map(([state, bs]) =>
        bs.length ? (
          <section key={state}>
            <Label className="mb-3">{state === "open" ? "Open now" : state === "upcoming" ? "Coming up" : "Closed"}</Label>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
              {bs.map((b) => (
                <Link key={b.slug} to={`/b/${b.slug}`} className="flex flex-col rounded-[3px] border border-line bg-card p-5 hover:border-line-strong">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xl font-semibold">{b.title}</span>
                    <span className="shrink-0 font-mono text-sm text-dim">
                      {state === "open" ? `${until(b.endsAt)} left` : state === "upcoming" ? `in ${until(b.startsAt)}` : "closed"}
                    </span>
                  </div>
                  <p className="mt-2 flex-1 text-[15px] text-dim">{b.brief}</p>
                  <div className="mt-4 flex gap-5 font-mono text-sm text-dim">
                    <span>{b.maxNeurons === 1 ? "1 neuron" : `up to ${b.maxNeurons} neurons`}</span>
                    <span>{b.par === null ? "par being set" : `par ${Math.round(b.par)}`}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

type Row = { layer: string; n: string; dose: string };

export function Bounty() {
  const { slug = "" } = useParams();
  const { requireJoin } = useSession();
  const b = useQuery(api.bounties.get, { slug });
  const submit = useMutation(api.bounties.submit);
  const { unlock } = useNotes();
  const [rows, setRows] = useState<Row[]>([{ layer: "", n: "", dose: "0.5" }]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);

  if (b === undefined) return <p className="py-20 text-center text-dim">Loading…</p>;
  if (b === null) return <p className="py-20 text-center text-dim">No such bounty.</p>;

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const go = async () => {
    setError(null);
    const ok = await requireJoin();
    if (!ok) return;
    const pushes = rows.filter((r) => r.layer !== "" || r.n !== "");
    if (!pushes.length || pushes.some((r) => r.layer === "" || r.n === "")) return setError("Fill in each neuron's layer and number");
    try {
      await submit({ slug, pushes: pushes.map((r) => ({ layer: Number(r.layer), n: Number(r.n), dose: Number(r.dose) })) });
      setOpen(0);
      unlock("dose");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-4xl font-bold tracking-tight">{b.title}</h1>
          <span className="ml-auto font-mono text-sm text-dim">
            {b.state === "open" ? `${until(b.endsAt)} left` : b.state === "upcoming" ? `opens in ${until(b.startsAt)}` : "closed"}
          </span>
        </div>
        <p className="mt-3 max-w-[60ch] text-lg">{b.brief}</p>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 font-mono text-sm text-dim">
          <span>up to <span className="text-fg">{b.maxNeurons}</span> {b.maxNeurons === 1 ? "neuron" : "neurons"}</span>
          <span>par <span className="text-fg">{b.par === null ? "being set" : Math.round(b.par)}</span></span>
          <span>score = 1000 × concept × coherence × efficiency</span>
        </div>

        <div className="mt-10">
          <Label className="mb-2">Leaderboard</Label>
          {b.leaderboard.length === 0 ? (
            <p className="text-dim">No scored entries yet.</p>
          ) : (
            <ScrollX label="Bounty leaderboard">
              <table className="w-full text-left font-mono text-sm">
                <tbody>
                  {b.leaderboard.map((e, i) => (
                    <tr key={i} className={`border-t border-line align-top ${e.you ? "text-fg" : ""}`}>
                      <td className="w-8 py-2 text-dim">{i + 1}</td>
                      <td className="py-2">
                        <Link to={`/t/${e.handle}`} className="hover:underline underline-offset-4">{e.handle}</Link>
                        {e.you && <span className="ml-2 text-dim">you</span>}
                        {e.pushes && (
                          <div className="mt-1 text-dim">
                            {e.pushes.map((p) => (
                              <span key={`${p.layer}:${p.n}`} className="mr-3">
                                <NeuronLink layer={p.layer} n={p.n} className="text-xs" /> ×{p.dose}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="w-20 py-2 text-dim">{e.neurons} {e.neurons === 1 ? "neuron" : "neurons"}</td>
                      <td className={`w-16 py-2 text-right ${b.par !== null && e.score > b.par ? "text-good" : ""}`}>{Math.round(e.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
          {b.state !== "closed" && b.leaderboard.length > 0 && <p className="mt-2 text-sm text-dim">Everyone's neurons stay secret until the bounty closes.</p>}
        </div>

        {b.mine.length > 0 && (
          <div className="mt-10">
            <Label className="mb-2">Your entries</Label>
            <div className="border-t border-line">
              {b.mine.map((e, i) => (
                <div key={i} className="border-b border-line py-2">
                  <button className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[3px] px-2 py-1 text-left font-mono text-sm hover:bg-card" onClick={() => setOpen(open === i ? null : i)}>
                    <span className="flex-1">
                      {e.pushes.map((p) => (
                        <span key={`${p.layer}:${p.n}`} className="mr-3">
                          L{p.layer} N{p.n} ×{p.dose}
                        </span>
                      ))}
                    </span>
                    {e.status === "done" ? (
                      <>
                        <span className="text-dim">concept {e.concept?.toFixed(2)}</span>
                        <span className="text-dim">coherence {e.coherence?.toFixed(2)}</span>
                        <span className="w-12 text-right text-fg">{Math.round(e.score ?? 0)}</span>
                      </>
                    ) : (
                      <span className={e.status === "failed" ? "text-glitch" : "text-dim"}>{e.status === "failed" ? "failed" : "judging…"}</span>
                    )}
                  </button>
                  {open === i && e.texts.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {e.texts.map((t, j) => (
                        <Reply key={j} text={t} className="border-l border-line-strong pl-3 text-dim" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="space-y-8 lg:sticky lg:top-16 lg:self-start">
        {b.state === "open" ? (
          <Panel ascii={b.slug} className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <div className="flex items-center justify-between">
              <Label>Your entry</Label>
              <span className="font-mono text-sm text-dim">{b.entriesLeft} entries left</span>
            </div>
            <div className="mt-2 space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <NeuronInput layer={r.layer} n={r.n} onLayer={(v) => setRow(i, { layer: v })} onN={(v) => setRow(i, { n: v })} />
                  <label className="block">
                    <span className="mb-1 block text-xs text-dim">Dose</span>
                    <Input value={r.dose} onChange={(e) => setRow(i, { dose: e.target.value })} className="w-20 text-center font-mono" inputMode="decimal" aria-label="dose" />
                  </label>
                  {rows.length > 1 && (
                    <button type="button" className="h-11 text-sm text-dim hover:text-fg" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button disabled={b.entriesLeft <= 0}>Submit</Button>
              {rows.length < b.maxNeurons && (
                <Button type="button" variant="ghost" onClick={() => setRows([...rows, { layer: "", n: "", dose: "0.5" }])}>
                  Add neuron
                </Button>
              )}
            </div>
            <p className="mt-3 text-sm text-dim">Dose goes from 0.05 to 1. A negative dose pushes the other way. Past 0.5 in total, you lose efficiency.</p>
            <div className="mt-1.5 min-h-4"><ErrorLine error={error} /></div>
          </form>
          </Panel>
        ) : (
          <p className="text-dim">{b.state === "upcoming" ? "Not open yet." : "This bounty is closed."}</p>
        )}
        <div>
          <Label className="mb-2">Find neurons by word</Label>
          <LensSearch
            pickLabel="add"
            onPick={(l, nn) => {
              const i = rows.findIndex((r) => r.layer === "" && r.n === "");
              if (i >= 0) setRow(i, { layer: String(l), n: String(nn) });
              else if (rows.length < b.maxNeurons) setRows([...rows, { layer: String(l), n: String(nn), dose: "0.5" }]);
              else setRow(rows.length - 1, { layer: String(l), n: String(nn) });
            }}
          />
        </div>
      </aside>
    </div>
  );
}
