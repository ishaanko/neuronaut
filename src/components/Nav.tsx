import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useSession } from "../lib/session";
import { firstVisit, markSeen } from "../lib/theme";
import { HowToPlay } from "./HowToPlay";

const LINKS = [
  ["/daily", "Daily"],
  ["/dex", "Dex"],
  ["/bounties", "Bounties"],
  ["/lab", "Lab"],
  ["/map", "Map"],
  ["/notes", "Notes"],
  ["/trainers", "Leaderboard"],
  ["/about", "About"],
] as const;

export function Nav() {
  const { me, signedIn, signIn, signOut, requireJoin } = useSession();
  const [help, setHelp] = useState(firstVisit);
  const closeHelp = () => {
    markSeen();
    setHelp(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-fg bg-bg/95 backdrop-blur-sm">
      {/* phones: logo and controls on one row, the links on a second row that scrolls sideways */}
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-3 px-4 sm:gap-x-6 sm:px-6">
        <Link to="/" className="flex h-14 shrink-0 items-center text-xl font-bold tracking-tight">
          Neuronaut<span className="text-rust">.</span>
        </Link>
        <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto whitespace-nowrap px-3 pb-2 [mask-image:linear-gradient(to_right,#000_85%,transparent)] lg:order-none lg:mx-0 lg:w-auto lg:p-0 lg:[mask-image:none]">
          {LINKS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `px-2 py-1.5 font-mono text-xs uppercase tracking-[0.12em] ${isActive ? "text-fg underline decoration-rust decoration-2 underline-offset-[6px]" : "text-dim hover:text-fg"}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex h-14 min-w-0 items-center gap-2 font-mono text-[13px] sm:gap-3">
          <button onClick={() => setHelp(true)} aria-label="How to play" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-fg text-dim hover:text-fg sm:h-auto sm:w-auto sm:border-0">
            <span aria-hidden className="sm:hidden">?</span>
            <span className="hidden sm:inline">How to play</span>
          </button>
          {me ? (
            <>
              <span className="hidden font-mono tabular-nums text-dim sm:inline" title="Your points">
                {me.points} pts
              </span>
              <Link to={`/t/${me.handle}`} title={me.handle} className="min-w-0 max-w-[5rem] truncate font-medium hover:underline underline-offset-4 sm:max-w-[10rem]">
                {me.handle}
              </Link>
              <button className="shrink-0 whitespace-nowrap text-dim hover:text-fg" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : signedIn ? (
            <>
              <button className="press h-9 shrink-0 whitespace-nowrap rounded-[3px] bg-accent px-3.5 font-medium text-accent-fg hover:bg-accent-hover" onClick={() => requireJoin()}>
                Pick a handle
              </button>
              <button className="shrink-0 whitespace-nowrap text-dim hover:text-fg" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="press h-9 shrink-0 whitespace-nowrap rounded-[3px] bg-accent px-3.5 font-medium text-accent-fg hover:bg-accent-hover" onClick={signIn}>
              Sign in
            </button>
          )}
        </div>
      </div>
      <HowToPlay open={help} onClose={closeHelp} />
    </header>
  );
}
