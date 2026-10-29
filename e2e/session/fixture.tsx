// This isolated browser entry point is not a Fast Refresh application module.
/* eslint-disable react/only-export-components */
import { StrictMode, act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider, useSession } from "../../src/players/session";
import { Lab } from "../../src/lab/Lab";
import { state } from "./mocks";

const root = createRoot(document.getElementById("root")!);
let session: ReturnType<typeof useSession>;
const outcomes: Record<string, boolean> = {};
let resolveJoin: () => void;
let rejectJoin: (error: Error) => void;
function Probe() {
  const value = useSession();
  useLayoutEffect(() => { session = value; });
  return <output data-testid="handle">{value.me?.handle ?? "none"}</output>;
}
const render = async (patch = {}) => {
  Object.assign(state, patch);
  await act(async () => root.render(<StrictMode><MemoryRouter><SessionProvider><Probe /><Lab /></SessionProvider></MemoryRouter></StrictMode>));
};
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  harness: {
    render,
    request: async (id: string) => { await act(async () => { void session.requireJoin().then((ok) => { outcomes[id] = ok; }); }); },
    outcomes,
    unmount: async () => { await act(async () => root.unmount()); },
    cancel: async () => { await act(async () => document.querySelector<HTMLDivElement>(".fixed.inset-0")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); },
    signOut: async () => { await act(async () => session.signOut()); },
    deferJoin: () => { state.join = () => new Promise<void>((yes, no) => { resolveJoin = yes; rejectJoin = no; }); },
    submit: async () => { await act(async () => document.querySelector(".fixed.inset-0 form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); },
    resolveJoin: async () => { await act(async () => resolveJoin()); },
    rejectJoin: async () => { await act(async () => rejectJoin(new Error("synthetic rejection"))); },
    clerkCalls: () => ({ signIns: state.signIns, signOuts: state.signOuts }),
  },
});
