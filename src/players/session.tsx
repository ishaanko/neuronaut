import { useAuth, useClerk } from "@clerk/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { createAccountGate, type AccountState } from "./accountGate";
import { guestToken } from "./guest";
import { JoinDialog } from "./JoinDialog";

type Session = {
  signedIn: boolean;
  settled: boolean; // auth and the player row have loaded, so signedIn and me can be trusted
  me: (typeof api.players.me)["_returnType"] | undefined; // undefined while loading, null without a player
  guest: string; // pass to the functions guests may use; the backend ignores it for a signed-in caller
  // Resolves true once the caller is a player. Signed out: opens Clerk's sign-in and resolves false (they act again
  // once signed in). Signed in without a handle: asks for one.
  requireJoin: () => Promise<boolean>;
  // requireJoin for the daily: a signed-out caller plays as a guest, so it resolves true for them too.
  requirePlay: () => Promise<boolean>;
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
};

const Ctx = createContext<Session | null>(null);

// Sign-in is Clerk; a player is a signed-in user who has picked a handle (players.join).
export function SessionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const clerk = useClerk();
  const { sessionId } = useAuth();
  const me = useQuery(api.players.me, isAuthenticated ? {} : "skip");
  const join = useMutation(api.players.join);
  const [guest] = useState(guestToken);
  const [gate] = useState(createAccountGate);
  const [asking, setAsking] = useState(false);
  const state: AccountState = isLoading || (isAuthenticated && me === undefined)
    ? "loading" : !isAuthenticated ? "signed-out" : me ? "ready" : "needs-handle";

  // Layout cleanup cancels waiters before another session can resume their actions.
  // React StrictMode may run setup again after cleanup, so activation is explicit.
  useLayoutEffect(() => {
    gate.activate();
    return () => gate.dispose();
  }, [gate]);
  const lastSession = useRef(sessionId);
  useLayoutEffect(() => {
    if (lastSession.current !== sessionId) setAsking(false);
    lastSession.current = sessionId;
    gate.update(sessionId, state);
    if (state === "ready" || state === "signed-out") setAsking(false);
  }, [gate, sessionId, state]);

  useEffect(() => {
    if (state === "needs-handle") setAsking(true);
  }, [state, sessionId]);

  const request = useCallback(async () => {
    if (state === "needs-handle") setAsking(true);
    return await gate.request();
  }, [state, gate]);

  const requireJoin = useCallback(async () => {
    const outcome = await request();
    // Signed out now, or a click made while auth was loading by someone who turned out to be signed out.
    if (outcome === "signed-out") clerk.openSignIn();
    return outcome === "ready";
  }, [request, clerk]);

  const requirePlay = useCallback(async () => {
    const outcome = await request();
    return outcome === "ready" || outcome === "signed-out";
  }, [request]);

  const cancel = () => {
    gate.cancel();
    setAsking(false);
  };
  const signOut = () => {
    cancel();
    void clerk.signOut();
  };

  return (
    <Ctx.Provider
      value={{
        signedIn: isAuthenticated,
        settled: state !== "loading",
        me: isAuthenticated ? me : null,
        guest,
        requireJoin,
        requirePlay,
        signIn: () => clerk.openSignIn(),
        signUp: () => clerk.openSignUp(),
        signOut,
      }}
    >
      {children}
      {asking && isAuthenticated && me === null && (
        <JoinDialog
          key={sessionId}
          onJoin={(handle) => gate.setup(() => join({ handle, guest }))}
          onClose={cancel}
          onSignOut={signOut}
        />
      )}
    </Ctx.Provider>
  );
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
