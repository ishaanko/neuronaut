import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LIMITS, MODEL, RARITIES, type Rarity } from "../../convex/rules";
import { CaughtMap } from "../components/CaughtMap";
import { LensSearch } from "../components/LensSearch";
import { Button, ErrorLine, Label, NeuronInput, NeuronLink, RarityTag, ScrollX, Steps, Tokens } from "../components/ui";
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
    <div className="space-y-10">
      <div className="space-y-5">
        <div>
          <h1 className="font-pixel text-4xl">DEX</h1>
          <div className="mt-1 h-6 text-dim">
            {overview ? `${overview.caught} caught · ${overview.profiled.toLocaleString()} of ${overview.total.toLocaleString()} measured` : "\u00a0"}
          </div>
        </div>
        <Steps
          steps={[
            <>Find a neuron: search a word, pick a spot on the map, or try a random one.</>,
            <>Predict what pushing it does, then scan it ({LIMITS.scans} a day) to see if you were right.</>,
            <>Catch it to make it yours ({LIMITS.catches} a day). Rarer and more unique scores more.</>,
          ]}
        />
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form
          className="rounded-2xl border border-line bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            open(false);
          }}
        >
          <div className="flex items-baseline justify-between">
            <Label>Open a neuron</Label>
            <span className="text-sm text-dim">{me ? `${me.scansLeft} scans, ${me.catchesLeft} catches left today` : "\u00a0"}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NeuronInput layer={layer} n={n} onLayer={setLayer} onN={setN} />
            <Button>Open</Button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="button" variant="ghost" size="lg" className="flex-1" onClick={() => open(true)}>
              Random
            </Button>
            <span className="text-sm text-dim">
              {me && me.predicted > 0 ? `Your predictions: ${me.predictedRight} of ${me.predicted} right` : "Don't know where to start? Try your luck."}
            </span>
          </div>
          <div className="mt-2 min-h-5">
            <ErrorLine error={error} />
          </div>
        </form>
        <div className="rounded-2xl border border-line bg-card p-5">
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
            <button key={t} onClick={() => setTab(t)} className={`-mb-px whitespace-nowrap border-b-2 py-3 text-base font-medium ${tab === t ? "border-fg text-fg" : "border-transparent text-dim hover:text-fg"}`}>
              {t === "caught" ? "Caught by everyone" : "Seen by you"}
            </button>
          ))}
          {tab === "caught" && (
            <div className="flex w-full flex-wrap gap-x-3 gap-y-1 pb-2 font-pixel text-xs uppercase md:ml-auto md:w-auto md:pb-0">
              <button onClick={() => setRarity(undefined)} className={rarity ? "text-faint hover:text-fg" : "text-fg"}>
                all
              </button>
              {RARITIES.map((r) => (
                <button key={r} onClick={() => setRarity(r)} className={rarity === r ? RARITY_COLOR[r] : "text-faint hover:text-fg"}>
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
  if (status === "LoadingFirstPage") return <div className="py-6 text-faint">loading</div>;
  if (!results.length) return <div className="py-6 text-dim">Nothing caught{rarity ? ` at ${rarity}` : ""} yet.</div>;
  return (
    <>
      <ScrollX label="Caught neurons">
        <table className="w-max min-w-full whitespace-nowrap text-left [&_td+td]:pl-4 [&_th+th]:pl-4 text-[15px]">
          <tbody>
            {results.map((c) => (
              <tr key={`${c.layer}:${c.n}`} className="border-b border-line align-baseline">
                <td className="py-3"><NeuronLink layer={c.layer} n={c.n} /></td>
                <td className="py-3 font-medium">{c.name}</td>
                <td className="py-3"><RarityTag rarity={c.rarity} /></td>
                <td className="py-3 text-dim whitespace-normal"><div className="max-w-xs"><Tokens tokens={c.words} /></div></td>
                <td className="py-3 font-mono text-xs">
                  <Link to={`/t/${c.handle}`} className="hover:underline underline-offset-4">{c.handle}</Link>
                </td>
                <td className="py-3 text-right font-mono text-xs">{c.points}</td>
                <td className="py-3 text-right font-mono text-xs text-faint">{ago(c.at)}</td>
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
  if (!signedIn) return <div className="py-6 text-dim">Pick a handle and scan some neurons.</div>;
  if (seen === undefined) return <div className="py-6 text-faint">loading</div>;
  if (!seen.length) return <div className="py-6 text-dim">You haven't scanned anything yet.</div>;
  return (
    <ScrollX label="Neurons you have seen">
      <table className="w-max min-w-full whitespace-nowrap text-left [&_td+td]:pl-4 [&_th+th]:pl-4 text-[15px]">
        <tbody>
          {seen.map((s) => (
            <tr key={`${s.layer}:${s.n}`} className="border-b border-line align-baseline">
              <td className="py-3"><NeuronLink layer={s.layer} n={s.n} /></td>
              <td className="py-3">{s.rarity ? <RarityTag rarity={s.rarity} /> : <span className="font-mono text-xs text-faint">measuring</span>}</td>
              <td className="py-3 text-dim whitespace-normal"><div className="max-w-xs"><Tokens tokens={s.words} /></div></td>
              <td className="py-3 font-mono text-xs text-faint">{s.source === "guess" ? "guessed" : "scanned"}</td>
              <td className="py-3 text-right font-mono text-xs">
                {s.caughtBy === "you" ? <span className="text-good">yours</span> : s.caughtBy ? <span className="text-faint">taken</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
