import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { HowToPlay } from "../learn/HowToPlay";
import { useSession } from "../players/session";
import { setTheme, useTheme } from "./theme";

// The how-to-play walkthrough opens by itself on a first visit, once.
const SEEN = "neuronaut:seen-howto";
const firstVisit = () => !localStorage.getItem(SEEN);
const markSeen = () => localStorage.setItem(SEEN, "1");

// The game modes, then About. Everything else (leaderboard, notes, rules) lives in the footer.
const LINKS = [
  ["/daily", "Daily"],
  ["/dex", "Dex"],
  ["/bounties", "Bounties"],
  ["/lab", "Lab"],
  ["/map", "Map"],
  ["/about", "About"],
] as const;
const FOOTER_LINKS = [
  ["/trainers", "Leaderboard"],
  ["/notes", "Notes"],
  ["/how", "Rules"],
] as const;

// The favicon's five squares in the site's ink, the middle one lit in rust: one neuron among many.
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="1 1 6 6" shapeRendering="crispEdges" className={className}>
      <path fill="currentColor" d="M1 1h2v2H1zM5 1h2v2H5zM1 5h2v2H1zM5 5h2v2H5z" />
      <path fill="var(--color-rust)" d="M3 3h2v2H3z" />
    </svg>
  );
}

export function Nav() {
  const { me, signedIn, signIn, requireJoin } = useSession();
  const [help, setHelp] = useState(firstVisit);
  const theme = useTheme();
  const closeHelp = () => {
    markSeen();
    setHelp(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line-strong bg-bg/95 backdrop-blur-sm">
      {/* phones: logo and controls on one row, the links spread across a second */}
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-3 px-4 md:gap-x-8 sm:px-6">
        <Link to="/" className="flex h-14 shrink-0 items-center gap-2 text-lg font-bold sm:gap-2.5 sm:text-xl tracking-tight">
          <Mark className="h-[18px] w-[18px]" />
          Neuronaut
        </Link>
        <nav className="order-last -mx-2 flex w-[calc(100%+1rem)] justify-between pb-2 md:order-none md:mx-0 md:w-auto md:justify-start md:gap-1 md:p-0">
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
        <div className="ml-auto flex h-14 min-w-0 items-center gap-1 font-mono text-[13px]">
          <button onClick={() => setHelp(true)} aria-label="How to play" className="h-8 shrink-0 whitespace-nowrap px-2 text-dim hover:text-fg">
            <span aria-hidden className="sm:hidden">Help</span>
            <span aria-hidden className="hidden sm:inline">How to play</span>
          </button>
          <button
            onClick={() => setTheme(theme === "dark" ? "paper" : "dark")}
            aria-label={theme === "dark" ? "Day theme" : "Night theme"}
            title={theme === "dark" ? "Day theme" : "Night theme"}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-dim hover:text-fg"
          >
            {/* the theme you'd switch to: a sun by night, a moon by day */}
            {theme === "dark" ? (
              <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
              </svg>
            ) : (
              <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" />
              </svg>
            )}
          </button>
          {me ? (
            <Link to={`/t/${me.handle}`} title={`${me.handle}, ${me.points} points`} className="ml-2 flex min-w-0 items-baseline gap-2 hover:text-fg">
              <span className="min-w-0 max-w-[6rem] truncate font-medium underline-offset-4 hover:underline sm:max-w-[10rem]">{me.handle}</span>
              <span className="hidden tabular-nums text-dim sm:inline">{me.points} pts</span>
            </Link>
          ) : signedIn ? (
            <button className="press ml-2 h-9 shrink-0 whitespace-nowrap rounded-[3px] bg-accent px-3 sm:px-3.5 font-medium text-accent-fg hover:bg-accent-hover" onClick={() => requireJoin()}>
              Pick a handle
            </button>
          ) : (
            <button className="press ml-2 h-9 shrink-0 whitespace-nowrap rounded-[3px] bg-accent px-3 sm:px-3.5 font-medium text-accent-fg hover:bg-accent-hover" onClick={signIn}>
              Sign in
            </button>
          )}
        </div>
      </div>
      <HowToPlay open={help} onClose={closeHelp} />
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto flex max-w-[1120px] flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line px-4 py-6 text-sm text-dim sm:px-6">
      <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-[0.12em]">
        {FOOTER_LINKS.map(([to, label]) => (
          <Link key={to} to={to} className="hover:text-fg">
            {label}
          </Link>
        ))}
      </nav>
      <span className="sm:ml-auto">
        Built on{" "}
        <a href="https://github.com/lyramakesmusic/neuron-explorer" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
          neuron-explorer
        </a>{" "}
        by lyramakesmusic
      </span>
    </footer>
  );
}
