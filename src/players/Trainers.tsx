import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { NeuronLink, RarityTag } from "../neuron/parts";
import { Label, PageTitle, ScrollX, Stat } from "../ui/primitives";
import { useSession } from "./session";

export function Trainers() {
  const top = useQuery(api.players.leaderboard);
  return (
    <div>
      <PageTitle>Leaderboard</PageTitle>
      {top === undefined ? (
        <p className="py-6 text-dim">Loading…</p>
      ) : top.length === 0 ? (
        <p className="py-6 text-dim">Nobody yet.</p>
      ) : (
        <ScrollX label="Trainer leaderboard" className="mt-6"><table className="w-full text-left font-mono text-sm">
          <thead>
            <tr>
              {["#", "trainer", "points", "caught", "dailies", "streak", "best", "bounty wins"].map((h, i) => (
                <th key={h} className={`pb-2 font-sans text-xs font-normal text-dim ${i > 1 ? "text-right" : ""} ${i > 4 ? "hidden sm:table-cell" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((p, i) => (
              <tr key={p.handle} className="border-t border-line">
                <td className="w-8 py-2 text-dim">{i + 1}</td>
                <td className="py-2"><Link to={`/t/${p.handle}`} className="text-fg hover:underline underline-offset-4">{p.handle}</Link></td>
                <td className="py-2 text-right text-fg">{p.points}</td>
                <td className="py-2 text-right">{p.caught}</td>
                <td className="py-2 text-right">{p.dailySolved}</td>
                <td className="hidden py-2 text-right sm:table-cell">{p.streak}</td>
                <td className="hidden py-2 text-right sm:table-cell">{p.bestStreak}</td>
                <td className="hidden py-2 text-right sm:table-cell">{p.bountyWins}</td>
              </tr>
            ))}
          </tbody>
        </table></ScrollX>
      )}
    </div>
  );
}

export function Trainer() {
  const { handle = "" } = useParams();
  const p = useQuery(api.players.profile, { handle });
  const { me, signOut } = useSession();
  if (p === undefined) return <p className="py-20 text-center text-dim">Loading…</p>;
  if (p === null) return <p className="py-20 text-center text-dim">No player called {handle}.</p>;
  return (
    <div className="max-w-[920px]">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 truncate text-4xl font-bold tracking-tight">{p.handle}</h1>
        {me?.handle === p.handle && (
          <button onClick={signOut} className="shrink-0 font-mono text-[13px] text-dim hover:text-fg">
            Sign out
          </button>
        )}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-5 border-y border-line py-5 sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Points" value={p.points} />
        <Stat label="Caught" value={p.catches.length} />
        <Stat label="Dailies" value={p.dailySolved} />
        <Stat label="Streak" value={p.streak} sub={`best ${p.bestStreak}`} />
        <Stat label="Bounty wins" value={p.bountyWins} />
        <Stat
          label="Predictions"
          value={p.predicted ? `${Math.round((100 * p.predictedRight) / p.predicted)}%` : "-"}
          sub={`${p.predictedRight} of ${p.predicted} right`}
        />
      </div>
      <div className="mt-10">
        <Label className="mb-2">Dex</Label>
        {p.catches.length === 0 ? (
          <p className="text-dim">No catches yet.</p>
        ) : (
          <ScrollX label={`${p.handle}'s dex`}><table className="w-full text-left">
            <tbody>
              {p.catches.map((c) => (
                <tr key={`${c.layer}:${c.n}`} className="border-t border-line align-baseline">
                  <td className="w-28 py-2"><NeuronLink layer={c.layer} n={c.n} /></td>
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="w-32 py-2"><RarityTag rarity={c.rarity} /></td>
                  <td className="w-16 py-2 text-right font-mono text-xs">{c.points}</td>
                  <td className="hidden w-24 py-2 text-right font-mono text-xs text-dim sm:table-cell">{c.date}</td>
                </tr>
              ))}
            </tbody>
          </table></ScrollX>
        )}
      </div>
    </div>
  );
}
