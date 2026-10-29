import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { NeuronLink } from "../neuron/parts";
import { useSession } from "../players/session";
import { useNow } from "../ui/now";
import { Button, Stat } from "../ui/primitives";
import { clock } from "../ui/time";
import { HEAT_BG, HEAT_EMOJI, heatBand } from "./heat";
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

// A finished puzzle's card: how it went, the heat of each guess, and the text to share. onClose: the card is leaving
// (to sign up).
export function ResultCard({ d, r, onClose }: { d: Puzzle; r: Result; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const now = useNow(true);
  const { me, signedIn, signUp } = useSession();
  const tally = useQuery(api.daily.tally, { date: d.date });
  return (
    <div>
      <h2 className="pop text-4xl font-bold">{r.solved ? "Solved" : "Out of guesses"}</h2>
      <p className="mt-2 text-lg">
        {d.practice ? "Practice" : "Daily"} #{d.number}
        {r.solved && `, in ${r.guesses} ${r.guesses === 1 ? "guess" : "guesses"}`}
        {r.seconds !== null && `, ${clock(r.seconds)}`}
      </p>
      <div className="mt-1 text-dim">
        It was <NeuronLink layer={r.answer.layer} n={r.answer.n} className="text-base text-fg" />
      </div>
      {/* the share grid: one square per guess, in its heat color */}
      <div className="mt-6 flex flex-wrap gap-1" role="img" aria-label={`Heat of each guess: ${r.heats.join(", ")}`}>
        {r.heats.map((h, i) => (
          <span key={i} className={`h-5 w-5 ${HEAT_BG[heatBand(h, r.solved && i === r.heats.length - 1)]}`} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-3 gap-4">
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
      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={() => {
          navigator.clipboard.writeText(shareText(d, r));
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Share"}
      </Button>
    </div>
  );
}
