import { ClerkProvider, useAuth } from "@clerk/react";
import { Analytics } from "@vercel/analytics/react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import "./index.css";
import { api } from "../convex/_generated/api";
import { Nav } from "./components/Nav";
import { NotesProvider } from "./lib/notes";
import { SessionProvider } from "./lib/session";
import { Daily } from "./pages/Daily";
import { Home } from "./pages/Home";

// Home and the daily (the main game) ship in the first bundle; the other pages load on first visit.
const Dex = lazy(() => import("./pages/Dex").then((m) => ({ default: m.Dex })));
const Neuron = lazy(() => import("./pages/Neuron").then((m) => ({ default: m.Neuron })));
const Bounties = lazy(() => import("./pages/Bounties").then((m) => ({ default: m.Bounties })));
const Bounty = lazy(() => import("./pages/Bounties").then((m) => ({ default: m.Bounty })));
const Trainers = lazy(() => import("./pages/Trainers").then((m) => ({ default: m.Trainers })));
const Trainer = lazy(() => import("./pages/Trainers").then((m) => ({ default: m.Trainer })));
const How = lazy(() => import("./pages/How").then((m) => ({ default: m.How })));
const MapPage = lazy(() => import("./pages/Map").then((m) => ({ default: m.MapPage })));
const Notes = lazy(() => import("./pages/Notes").then((m) => ({ default: m.Notes })));
const Lab = lazy(() => import("./pages/Lab").then((m) => ({ default: m.Lab })));

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

// Send the landing page's queries as soon as the socket opens instead of after React mounts (~230 ms sooner on a fast
// machine, around a second on a throttled phone). Signed-in players get a refreshed result once auth arrives.
const PREWARM = {
  "/": [api.neurons.overview, api.daily.current, api.bounties.list],
  "/daily": [api.daily.current],
  "/dex": [api.neurons.overview],
  "/bounties": [api.bounties.list],
  "/map": [api.map.caught],
} as const;
for (const query of PREWARM[location.pathname as keyof typeof PREWARM] ?? [])
  convex.prewarmQuery({ query, args: {}, extendSubscriptionFor: 10_000 });

// Clerk's sign-in modal in the site's colors.
function Clerk({ children }: { children: ReactNode }) {
  const appearance = {
    variables: {
      colorBackground: "#f4f0e6",
      colorText: "#1b1814",
      colorPrimary: "#1b1814",
      colorTextOnPrimaryBackground: "#f4f0e6",
      colorInputBackground: "#ece7dc",
      colorInputText: "#1b1814",
      fontFamily: '"Source Serif 4", Georgia, serif',
      borderRadius: "3px",
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
                    <Route path="*" element={<p className="py-20 text-center text-dim">Nothing here.</p>} />
                  </Routes>
                </Suspense>
              </main>
              <footer className="mx-auto flex max-w-[1120px] flex-wrap gap-x-6 gap-y-2 border-t border-line px-4 py-6 text-sm text-dim sm:px-6">
                <span>
                  Built on{" "}
                  <a href="https://github.com/lyramakesmusic/neuron-explorer" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                    neuron-explorer
                  </a>{" "}
                  by lyramakesmusic
                </span>
                <Link to="/how" className="hover:text-fg">
                  Rules and scoring
                </Link>
              </footer>
              <Analytics />
            </NotesProvider>
          </SessionProvider>
        </BrowserRouter>
      </ConvexProviderWithClerk>
    </Clerk>
  </StrictMode>,
);
