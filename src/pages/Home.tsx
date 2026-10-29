import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LIMITS, MODEL, bountyState } from "../../convex/rules";
import { HowToPlay } from "../components/HowToPlay";
import { Specimen } from "../components/Specimen";
import { Label, NeuronLink, RarityTag } from "../components/ui";
import { ago, plainReply, until } from "../lib/format";
import { useNow } from "../lib/now";
import { useSession } from "../lib/session";

// One cell in the strip of modes under the hero: name, one line on what you do, and its live status.
function Mode({ to, name, line, status }: { to: string; name: string; line: string; status: string }) {
  return (
    <Link to={to} className="group flex flex-col gap-1 py-5 lg:px-5 lg:first:pl-0 lg:last:pr-0">
      <span className="text-lg font-bold underline-offset-4 group-hover:underline">{name}</span>
      <span className="text-[15px] text-dim">{line}</span>
      <span className="mt-auto pt-2 font-mono text-sm">{status}</span>
    </Link>
  );
}

export function Home() {
  const overview = useQuery(api.neurons.overview);
  const { guest } = useSession();
  const daily = useQuery(api.daily.current, { guest });
  const tally = useQuery(api.daily.tally, daily ? { date: daily.date } : "skip");
  const bounties = useQuery(api.bounties.list);
  const [example, setExample] = useState(false);
  const now = useNow(true, 30_000);
  const open = bounties?.filter((b) => bountyState(b, now) === "open") ?? [];
  const total = MODEL.layers * MODEL.width;

  const dailyStatus = !daily
    ? "being picked"
    : daily.result
      ? daily.result.solved
        ? `you solved it in ${daily.result.guesses}`
        : "you missed it"
      : daily.guesses.length
        ? `${daily.guesses.length}/${daily.limit} guesses in`
        : `${tally?.solvers ?? 0} solved so far`;

  return (
    <div className="space-y-12 lg:space-y-16">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-x-16 lg:pt-8">
        <div>
          <h1 className="text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-6xl">
            Find the neuron <span className="text-rust">behind the words.</span>
          </h1>
          <p className="mt-6 max-w-[44ch] text-lg text-dim">
            {MODEL.name} has {total.toLocaleString()} neurons. Push one and the model starts talking about the sea, thinks
            it's a doctor, or falls apart. Every day one is hidden, and you get {LIMITS.guesses} guesses to find it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/daily" className="press inline-flex h-12 items-center rounded-[3px] bg-accent px-6 font-mono text-[15px] font-medium text-accent-fg hover:bg-accent-hover">
              Play daily{daily ? ` Nº ${daily.number}` : ""}
            </Link>
            <button onClick={() => setExample(true)} className="press h-12 rounded-[3px] border border-fg px-5 font-mono text-[15px] font-medium hover:bg-raised">
              Watch a game
            </button>
          </div>
        </div>

        {/* the hook: a destructive neuron eating a reply. Second on phones, beside the intro on wide screens */}
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line-strong lg:pl-12">
          <Specimen />
        </div>

        {/* one of today's strange answers, word for word */}
        {daily && (
          <Link to="/daily" className="group block self-start border-t border-line-strong pt-4 lg:col-start-1">
            <div className="flex items-baseline justify-between gap-4">
              <Label>Today's neuron, Nº {daily.number}</Label>
              <span className="shrink-0 font-mono text-xs text-dim">{dailyStatus}</span>
            </div>
            <div className="mt-3 font-semibold">{daily.prompts[0]}</div>
            <p className="mt-1 line-clamp-3 text-[15px] leading-relaxed text-dim group-hover:text-fg">{plainReply(daily.texts[0])}</p>
          </Link>
        )}
      </section>

      <section className="grid divide-y divide-line-strong border-y border-fg lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <Mode to="/dex" name="Dex" line={`Guess what a neuron does, scan it, catch the good ones. ${LIMITS.catches} catches a day.`} status={`${overview?.caught ?? 0} caught`} />
        <Mode
          to="/bounties"
          name="Bounties"
          line="Steer the model toward a target with as little push as you can."
          status={open.length ? `${open.length} open, ${until(Math.min(...open.map((b) => b.endsAt)))} left` : "none open"}
        />
        <Mode to="/lab" name="Lab" line="Push two neurons at once and see if their effects add up." status={`${LIMITS.experiments} a day`} />
        <Mode to="/map" name="Map" line="Every neuron that does something, laid out by what it does." status="explore" />
      </section>

      {overview?.recent.length ? (
        <section>
          <Label className="mb-3">Latest catches</Label>
          <div className="grid border-t border-line lg:grid-cols-2 lg:gap-x-12">
            {overview.recent.map((c) => (
              <div key={`${c.layer}:${c.n}`} className="flex items-center gap-3 border-b border-line py-2.5">
                <NeuronLink layer={c.layer} n={c.n} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <RarityTag rarity={c.rarity} />
                <span className="w-8 text-right font-mono text-xs text-faint">{ago(c.at)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <HowToPlay open={example} onClose={() => setExample(false)} />
    </div>
  );
}
