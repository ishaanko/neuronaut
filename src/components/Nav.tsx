import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useSession } from "../lib/session";
import { firstVisit, markSeen, useTheme } from "../lib/theme";
import { HowToPlay } from "./HowToPlay";

const LINKS = [
  ["/daily", "Daily"],
  ["/dex", "Dex"],
  ["/map", "Map"],
  ["/bounties", "Bounties"],
  ["/lab", "Lab"],
  ["/notes", "Notes"],
  ["/trainers", "Leaderboard"],
] as const;

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-dim hover:bg-raised hover:text-fg">
      {children}
    </button>
  );
}

export function Nav() {
  const { me, signedIn, signIn, signOut, requireJoin } = useSession();
  const { dark, toggle } = useTheme();
  const [help, setHelp] = useState(firstVisit);
  const closeHelp = () => {
    markSeen();
    setHelp(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-sm">
      {/* phones: logo and controls on one row, the links on a second row that scrolls sideways. With a handle, the
          controls ask for 13rem (room for about 3rem of handle) and the handle truncates; without one they ask for their
          content width. Either way they wrap to their own row when that doesn't fit beside the logo. */}
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-4 px-4 sm:px-6 md:gap-x-6">
        <Link to="/" className="flex h-14 shrink-0 items-center font-pixel text-lg tracking-wide">
          NEURONAUT
        </Link>
        <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto whitespace-nowrap px-3 pb-2 md:order-none md:mx-0 md:w-auto md:p-0">
          {LINKS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `rounded-lg px-3 py-2 text-[15px] font-medium ${isActive ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={`flex h-14 min-w-0 flex-1 items-center justify-end gap-1 ${me ? "basis-52" : "basis-auto"}`}>
          <IconButton label="How to play" onClick={() => setHelp(true)}>
            <span className="text-lg font-semibold">?</span>
          </IconButton>
          <IconButton label={dark ? "Light mode" : "Dark mode"} onClick={toggle}>
            {dark ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </IconButton>
          {me ? (
            <div className="ml-2 flex min-w-0 items-center gap-3 text-sm">
              <span className="hidden shrink-0 rounded-lg bg-raised px-2.5 py-1 font-mono tabular-nums sm:inline" title="Your points">
                {me.points} pts
              </span>
              <Link to={`/t/${me.handle}`} title={me.handle} className="min-w-0 truncate font-semibold hover:underline underline-offset-4">
                {me.handle}
              </Link>
              <button className="shrink-0 whitespace-nowrap text-dim hover:text-fg" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : signedIn ? (
            <div className="ml-2 flex shrink-0 items-center gap-3 text-sm">
              <button className="press h-10 rounded-xl bg-accent px-4 font-semibold text-accent-fg" onClick={() => requireJoin()}>
                Pick a handle
              </button>
              <button className="shrink-0 whitespace-nowrap text-dim hover:text-fg" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="press ml-2 h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg" onClick={signIn}>
              Sign in
            </button>
          )}
        </div>
      </div>
      <HowToPlay open={help} onClose={closeHelp} />
    </header>
  );
}
