import { ClerkProvider, useAuth } from "@clerk/react";
import { Analytics } from "@vercel/analytics/react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { api } from "../convex/_generated/api";
import { Footer, Nav } from "./app/Nav";
import { useTheme } from "./app/theme";
import { Daily } from "./daily/Daily";
import { Home } from "./home/Home";
import { NotesProvider } from "./learn/fieldNotes";
import { guestToken } from "./players/guest";
import { SessionProvider } from "./players/session";

// Home and the daily (the main game) ship in the first bundle; the other pages load on first visit.
const Dex = lazy(() => import("./dex/Dex").then((m) => ({ default: m.Dex })));
const Neuron = lazy(() => import("./dex/Neuron").then((m) => ({ default: m.Neuron })));
const Bounties = lazy(() => import("./bounties/Bounties").then((m) => ({ default: m.Bounties })));
const Bounty = lazy(() => import("./bounties/Bounties").then((m) => ({ default: m.Bounty })));
const Trainers = lazy(() => import("./players/Trainers").then((m) => ({ default: m.Trainers })));
const Trainer = lazy(() => import("./players/Trainers").then((m) => ({ default: m.Trainer })));
const How = lazy(() => import("./learn/How").then((m) => ({ default: m.How })));
const MapPage = lazy(() => import("./map/Map").then((m) => ({ default: m.MapPage })));
const Notes = lazy(() => import("./learn/Notes").then((m) => ({ default: m.Notes })));
const Lab = lazy(() => import("./lab/Lab").then((m) => ({ default: m.Lab })));
const About = lazy(() => import("./learn/About").then((m) => ({ default: m.About })));

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

// Send the landing page's queries as soon as the socket opens instead of after React mounts (~230 ms sooner on a fast
// machine, around a second on a throttled phone). Signed-in players get a refreshed result once auth arrives.
const PREWARM = {
  "/": [api.neurons.overview, api.bounties.list],
  "/dex": [api.neurons.overview],
  "/bounties": [api.bounties.list],
  "/map": [api.map.caught],
} as const;
for (const query of PREWARM[location.pathname as keyof typeof PREWARM] ?? [])
  convex.prewarmQuery({ query, args: {}, extendSubscriptionFor: 10_000 });
if (location.pathname === "/" || location.pathname === "/daily")
  convex.prewarmQuery({ query: api.daily.current, args: { guest: guestToken() }, extendSubscriptionFor: 10_000 });

// Clerk's sign-in modal in the site's colors. It can't use CSS variables, so it gets the current theme's values, read
// again when the theme changes.
function Clerk({ children }: { children: ReactNode }) {
  useTheme();
  const css = getComputedStyle(document.documentElement);
  const c = { bg: css.getPropertyValue("--color-bg"), ink: css.getPropertyValue("--color-fg") };
  const appearance = {
    variables: {
      colorBackground: c.bg,
      colorText: c.ink,
      colorPrimary: c.ink,
      colorTextOnPrimaryBackground: c.bg,
      colorInputBackground: c.bg,
      colorInputText: c.ink,
      fontFamily: '"Source Serif 4", Georgia, serif',
      borderRadius: "0",
    },
  };
  return (
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY} appearance={appearance}>
      {children}
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Clerk>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <BrowserRouter>
          <SessionProvider>
            <NotesProvider>
              <Nav />
              <main className="mx-auto min-h-[calc(100svh-3.5rem)] max-w-[1120px] px-4 py-8 sm:px-6 sm:py-10">
                <Suspense fallback={<p className="py-20 text-center text-dim">Loading…</p>}>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/daily" element={<Daily />} />
                    <Route path="/daily/:date" element={<Daily />} />
                    <Route path="/map" element={<MapPage />} />
                    <Route path="/notes" element={<Notes />} />
                    <Route path="/lab" element={<Lab />} />
                    <Route path="/dex" element={<Dex />} />
                    <Route path="/n/:layer/:n" element={<Neuron />} />
                    <Route path="/bounties" element={<Bounties />} />
                    <Route path="/b/:slug" element={<Bounty />} />
                    <Route path="/trainers" element={<Trainers />} />
                    <Route path="/t/:handle" element={<Trainer />} />
                    <Route path="/how" element={<How />} />
                    <Route path="/about" element={<About />} />
                    <Route path="*" element={<p className="py-20 text-center text-dim">Nothing here.</p>} />
                  </Routes>
                </Suspense>
              </main>
              <Footer />
              <Analytics />
            </NotesProvider>
          </SessionProvider>
        </BrowserRouter>
      </ConvexProviderWithClerk>
    </Clerk>
  </StrictMode>,
);
