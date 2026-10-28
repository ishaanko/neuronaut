import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LIMITS, MODEL, RARITIES, type Rarity } from "../../convex/rules";
import { CaughtMap } from "../components/CaughtMap";
import { LensSearch } from "../components/LensSearch";
import { Button, ErrorLine, Label, NeuronInput, NeuronLink, Panel, RarityTag, ScrollX, Tokens } from "../components/ui";
import { ago, RARITY_COLOR } from "../lib/format";
import { useSession } from "../lib/session";

export function Dex() {
  const { me } = useSession();
  const nav = useNavigate();
  const overview = useQuery(api.neurons.overview);
  const [tab, setTab] = useState<"caught" | "seen">("caught");
  const [rarity, setRarity] = useState<Rarity | undefined>(undefined);
  const [layer, setLayer] = useState("");
  const [n, setN] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Opens the neuron's page, where the player predicts what it does and scans it.
  const open = (random: boolean) => {
    setError(null);
    if (random) return nav(`/n/${Math.floor(Math.random() * MODEL.layers)}/${Math.floor(Math.random() * MODEL.width)}`);
    if (layer === "" || n === "") return setError("Enter a layer and a neuron, or pick a random one");
    if (Number(layer) >= MODEL.layers || Number(n) >= MODEL.width) return setError(`Layers go to ${MODEL.layers - 1}, neurons to ${MODEL.width - 1}`);
    nav(`/n/${Number(layer)}/${Number(n)}`);
  };

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Dex<span className="text-rust">.</span></h1>
          <div className="mt-1 min-h-6 text-dim">{overview ? `${overview.caught} caught · ${overview.profiled.toLocaleString()} of ${overview.total.toLocaleString()} measured` : " "}</div>
        </div>
        <p className="max-w-[70ch] text-dim">
          Pick a neuron and guess what pushing it will do. Scanning shows you ({LIMITS.scans} scans a day). If it's good, catch it
          and name it. Each neuron can only be caught once, and rare ones unlike anything caught so far score the most.
        </p>
      </div>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Panel ascii="dex" className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              open(false);
            }}
          >
            <div className="flex items-baseline justify-between gap-4">
              <Label>Open a neuron</Label>
              <span className="text-sm text-dim">{me ? `${me.scansLeft} scans, ${me.catchesLeft} catches left today` : ""}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <NeuronInput layer={layer} n={n} onLayer={setLayer} onN={setN} />
              <Button>Open</Button>
              <Button type="button" variant="ghost" onClick={() => open(true)}>
                Random
              </Button>
            </div>
            <div className="mt-2 min-h-5">
              <ErrorLine error={error} />
            </div>
            {me && me.predicted > 0 && (
              <p className="text-sm text-dim">
                Your predictions: {me.predictedRight} of {me.predicted} right
              </p>
            )}
          </form>
        </Panel>
        <div>
          <Label className="mb-3">Find neurons by word</Label>
          <LensSearch pickLabel="Open" onPick={(l, nn) => nav(`/n/${l}/${nn}`)} />
        </div>
      </section>

      <section>
        <CaughtMap />
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-x-5 border-b border-line">
          {(["caught", "seen"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px whitespace-nowrap border-b-2 py-3 font-medium ${tab === t ? "border-fg text-fg" : "border-transparent text-dim hover:text-fg"}`}>
              {t === "caught" ? "Caught by everyone" : "Seen by you"}
            </button>
          ))}
          {tab === "caught" && (
            <div className="flex w-full flex-wrap gap-x-3 gap-y-1 pb-2 font-mono text-xs md:ml-auto md:w-auto md:pb-0">
              <button onClick={() => setRarity(undefined)} className={rarity ? "text-dim hover:text-fg" : "text-fg underline underline-offset-4"}>
                all
              </button>
              {RARITIES.map((r) => (
                <button key={r} onClick={() => setRarity(r)} className={rarity === r ? `${RARITY_COLOR[r]} underline underline-offset-4` : "text-dim hover:text-fg"}>
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        {tab === "caught" ? <Caught rarity={rarity} /> : <Seen signedIn={!!me} />}
      </section>
    </div>
  );
}

function Caught({ rarity }: { rarity?: Rarity }) {
  const { results, status, loadMore } = usePaginatedQuery(api.neurons.dex, { rarity }, { initialNumItems: 50 });
  if (status === "LoadingFirstPage") return <p className="py-6 text-dim">Loading…</p>;
  if (!results.length) return <p className="py-6 text-dim">Nothing caught{rarity ? ` at ${rarity}` : ""} yet.</p>;
  return (
    <>
      <ScrollX label="Caught neurons">
        <table className="w-full text-left text-[15px]">
          <tbody>
            {results.map((c) => (
              <tr key={`${c.layer}:${c.n}`} className="border-b border-line align-baseline">
                <td className="w-24 py-3">
                  <NeuronLink layer={c.layer} n={c.n} />
                </td>
                <td className="py-3 font-medium">{c.name}</td>
                <td className="w-28 py-3">
                  <RarityTag rarity={c.rarity} />
                </td>
                <td className="hidden max-w-xs py-3 text-dim md:table-cell">
                  <div className="max-w-xs truncate">
                    <Tokens tokens={c.words} />
                  </div>
                </td>
                <td className="hidden w-28 py-3 font-mono text-xs sm:table-cell">
                  <Link to={`/t/${c.handle}`} className="hover:underline underline-offset-4">
                    {c.handle}
                  </Link>
                </td>
                <td className="hidden w-12 py-3 text-right font-mono text-xs sm:table-cell">{c.points}</td>
                <td className="w-10 py-3 text-right font-mono text-xs text-faint">{ago(c.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      {status === "CanLoadMore" && (
        <Button variant="ghost" className="mt-4" onClick={() => loadMore(50)}>
          More
        </Button>
      )}
    </>
  );
}

function Seen({ signedIn }: { signedIn: boolean }) {
  const seen = useQuery(api.neurons.seen, {});
  if (!signedIn) return <p className="py-6 text-dim">Sign in and scan a neuron to start your list.</p>;
  if (seen === undefined) return <p className="py-6 text-dim">Loading…</p>;
  if (!seen.length) return <p className="py-6 text-dim">You haven't scanned anything yet.</p>;
  return (
    <ScrollX label="Neurons you have seen">
      <table className="w-full text-left text-[15px]">
        <tbody>
          {seen.map((s) => (
            <tr key={`${s.layer}:${s.n}`} className="border-b border-line align-baseline">
              <td className="w-24 py-3">
                <NeuronLink layer={s.layer} n={s.n} />
              </td>
              <td className="w-28 py-3">{s.rarity ? <RarityTag rarity={s.rarity} /> : <span className="font-mono text-xs text-faint">measuring</span>}</td>
              <td className="hidden py-3 text-dim sm:table-cell">
                <Tokens tokens={s.words} />
              </td>
              <td className="w-20 py-3 font-mono text-xs text-dim">{s.source === "guess" ? "guessed" : "scanned"}</td>
              <td className="w-16 py-3 text-right font-mono text-xs">
                {s.caughtBy === "you" ? <span className="text-good">yours</span> : s.caughtBy ? <span className="text-dim">taken</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
