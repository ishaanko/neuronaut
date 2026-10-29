import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { NeuronLink } from "../neuron/parts";
import { useSession } from "../players/session";
import { useNow } from "../ui/now";
import { Button, Stat } from "../ui/primitives";
import { clock } from "../ui/time";
import { HEAT_EMOJI, heatBand } from "./heat";
import { HeatChart } from "./HeatChart";
import type { Puzzle, Result } from "./puzzle";

function shareText(d: Puzzle, r: Result) {
  const sq = r.heats.map((h, i) => HEAT_EMOJI[heatBand(h, r.solved && i === r.heats.length - 1)]).join("");
  const time = r.seconds === null ? "" : ` in ${clock(r.seconds)}`;
  return `Neuronaut #${d.number}${r.practice ? " (practice)" : ""} ${r.solved ? r.guesses : "X"}/${d.limit}${time}\n${sq}\n${location.origin}/daily`;
}

// Time until the next puzzle (00:00 UTC).
function untilNext(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return clock((next.getTime() - now) / 1000);
}

// A finished puzzle's card: how it went, the heat of each guess, and the text to share.
export function ResultCard({ d, r, onClose }: { d: Puzzle; r: Result; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const now = useNow(true);
  const { me, signedIn, signUp } = useSession();
  const tally = useQuery(api.daily.tally, { date: d.date });
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-dim">
        {d.practice ? "Practice" : "Daily"} Nº {d.number}
      </div>
      <div className={`pop mt-1 text-4xl font-bold tracking-tight ${r.solved ? "text-rust" : "text-fg"}`}>{r.solved ? "Solved." : "Out of guesses."}</div>
      <p className="mt-1 text-lg">
        {r.solved ? `Solved in ${r.guesses} ${r.guesses === 1 ? "guess" : "guesses"}` : "The neuron got away."}
        {r.seconds !== null && <span className="text-dim">, {clock(r.seconds)}</span>}
      </p>
      <div className="mt-1 text-dim">
        It was <NeuronLink layer={r.answer.layer} n={r.answer.n} className="text-base text-fg" />
      </div>
      <HeatChart className="mt-5" slots={d.limit} marks={r.heats.map((h, i) => ({ heat: h, correct: r.solved && i === r.heats.length - 1 }))} />
      <div className="mt-4 grid grid-cols-3 gap-4 border-y border-fg py-4">
        <Stat label={d.practice ? "Solved that day" : "Solved today"} value={tally?.solvers ?? "-"} />
        <Stat label="Your streak" value={d.practice || !signedIn ? "-" : (me?.streak ?? 0)} />
        <Stat label="Next neuron" value={untilNext(now)} />
      </div>
      {!signedIn && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-dim">Make an account to keep this result, start a streak and get on the leaderboard.</p>
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              onClose();
              signUp();
            }}
          >
            Make an account
          </Button>
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(shareText(d, r));
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Share"}
        </Button>
        <Button size="lg" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
