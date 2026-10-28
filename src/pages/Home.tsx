import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LIMITS, MODEL } from "../../convex/rules";
import { CaughtMap } from "../components/CaughtMap";
import { HowToPlay } from "../components/HowToPlay";
import { Reply } from "../components/Replies";
import { ChartLegend, HeatChart } from "../components/HeatChart";
import { EXAMPLE } from "../data/example";
import { Label, NeuronLink, Plate, RarityTag } from "../components/ui";
import { ago, until } from "../lib/format";
import { useSession } from "../lib/session";

// A mode in the list under the hero: name, one line on what you do, and its live status.
function Mode({ to, name, line, status }: { to: string; name: string; line: string; status: string }) {
  return (
    <Link to={to} className="group grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[8rem_1fr_auto] sm:items-baseline">
      <span className="text-lg font-bold group-hover:underline underline-offset-4">{name}</span>
      <span className="text-dim">{line}</span>
      <span className="font-mono text-sm text-dim">{status}</span>
    </Link>
  );
}

export function Home() {
  const overview = useQuery(api.neurons.overview);
  const { guest } = useSession();
  const daily = useQuery(api.daily.current, { guest });
  const bounties = useQuery(api.bounties.list);
  const [example, setExample] = useState(false);
  const open = bounties?.filter((b) => b.state === "open") ?? [];
  const total = MODEL.layers * MODEL.width;

  const dailyStatus = !daily
    ? "being picked"
    : daily.result
      ? daily.result.solved
        ? `solved in ${daily.result.guesses}`
        : "missed"
      : daily.guesses.length
        ? `${daily.guesses.length}/${daily.limit} guesses`
        : `${daily.solvers} solved`;

  // the hook: one of today's strange answers, word for word
  const clue = daily ? { prompt: daily.prompts[0], reply: daily.texts[0] } : null;

  return (
    <div className="space-y-14">
      <Plate
        no={daily ? String(daily.number).padStart(3, "0") : "000"}
        path={`${MODEL.id.toLowerCase()} / ${total.toLocaleString()} neurons`}
        cells={[
          { label: "Model", value: MODEL.name },
          { label: "Neurons", value: total.toLocaleString() },
          { label: "Today", value: daily ? `Nº ${daily.number}, ${dailyStatus}` : "being picked" },
          { label: "Caught", value: overview ? overview.caught.toLocaleString() : "…" },
        ]}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="lg:pr-4">
            <h1 className="text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-6xl">
              Find the neuron <span className="text-rust">behind the words.</span>
            </h1>
            <p className="mt-4 text-xl italic">Field notes from inside a language model.</p>
            <p className="mt-5 max-w-[46ch] text-dim">
              {MODEL.name} has {total.toLocaleString()} neurons. Push one and the model starts talking about the sea, thinks
              it's a doctor, or falls apart. Every day one of them is hidden, and you get {LIMITS.guesses} guesses to find it.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/daily" className="press inline-flex h-12 items-center rounded-[3px] bg-accent px-6 font-mono text-[15px] font-medium text-accent-fg hover:bg-accent-hover">
                Play daily{daily ? ` Nº ${daily.number}` : ""}
              </Link>
              <button onClick={() => setExample(true)} className="press h-12 rounded-[3px] border border-fg px-5 font-mono text-[15px] font-medium hover:bg-raised">
                Watch a game
              </button>
            </div>
          </div>
          <div className="space-y-6 lg:border-l lg:border-line-strong lg:pl-8">
            {clue && (
              <figure>
                <figcaption className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">Today, with the hidden neuron pushed</figcaption>
                <div className="mt-2 font-semibold">{clue.prompt}</div>
                <Reply text={clue.reply} className="mt-1" />
              </figure>
            )}
            <figure>
              <ChartLegend className="border-b border-line-strong pb-2" />
              <HeatChart marks={EXAMPLE.steps.flatMap((st) => (st.guess ? [st.guess] : []))} slots={6} className="mt-2" />
              <figcaption className="text-sm italic text-dim">
                Fig. 1. A real game of Nº {EXAMPLE.number}, solved in five guesses.{" "}
                <button onClick={() => setExample(true)} className="not-italic text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                  Watch it
                </button>
              </figcaption>
            </figure>
          </div>
        </div>
      </Plate>

      <section>
        <Label>Other ways to play</Label>
        <div className="mt-2 divide-y divide-line-strong border-y border-fg">
          <Mode to="/dex" name="Dex" line={`Guess what a neuron does, scan it, catch the good ones. ${LIMITS.catches} catches a day.`} status={`${overview?.caught ?? 0} caught`} />
          <Mode
            to="/bounties"
            name="Bounties"
            line="Steer the model toward a target, like French or the sea, with as little push as you can."
            status={open.length ? `${open.length} open, ${until(Math.min(...open.map((b) => b.endsAt)))} left` : "none open"}
          />
          <Mode to="/lab" name="Lab" line="Push two neurons at once and see if their effects add up." status={`${LIMITS.experiments} a day`} />
          <Mode to="/map" name="Map" line="Every neuron that does something, laid out by what it does." status="explore" />
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <CaughtMap />
        <div>
          <Label className="mb-3">Latest catches</Label>
          {overview?.recent.length ? (
            <div className="divide-y divide-line border-y border-line">
              {overview.recent.map((c) => (
                <div key={`${c.layer}:${c.n}`} className="flex items-center gap-3 py-2.5">
                  <NeuronLink layer={c.layer} n={c.n} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <RarityTag rarity={c.rarity} />
                  <span className="w-8 text-right font-mono text-xs text-faint">{ago(c.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-dim">Nothing caught yet.</p>
          )}
        </div>
      </section>

      <HowToPlay open={example} onClose={() => setExample(false)} />
    </div>
  );
}
