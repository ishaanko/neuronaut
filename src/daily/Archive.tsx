import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useSession } from "../players/session";
import { Label } from "../ui/primitives";

// Past puzzles to replay for practice, newest first.
export function Archive({ current }: { current: string }) {
  const { guest } = useSession();
  const past = useQuery(api.daily.archive, { guest });
  if (!past?.length) return null;
  return (
    <section>
      <Label>Past puzzles</Label>
      <p className="mb-3 mt-1 text-dim">Practice on these. Same scoring, but no points and no streak. Mondays are easiest, weekends hardest.</p>
      <div className="divide-y divide-line border-y border-line">
        {past.map((p) => (
          <Link key={p.date} to={`/daily/${p.date}`} className={`flex items-center gap-4 py-3 hover:bg-card ${p.date === current ? "bg-card" : ""}`}>
            <span className="w-12 font-mono">#{p.number}</span>
            <span className="w-20 text-sm text-dim">{p.difficulty ?? ""}</span>
            <span className="ml-auto text-sm text-dim">
              {p.mine ? (p.mine.solved ? `you solved it in ${p.mine.guesses}` : "you missed it") : p.players ? `${p.solvers} of ${p.players} solved` : "nobody played"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
