// Coordinates actions waiting for Convex authentication and a confirmed player row.
// A generation belongs to one session/setup attempt; stale callbacks cannot release a newer attempt.
export type AccountState = "loading" | "signed-out" | "needs-handle" | "ready";
// How a waiting action ends: its account is ready, it turned out to be signed out (the caller should offer sign-in),
// or it was dropped (session switch, explicit sign-out, dialog closed, failed join, unmount).
export type Outcome = "ready" | "signed-out" | "cancelled";

export function createAccountGate() {
  let active = true;
  let session: string | null | undefined;
  let state: AccountState = "loading";
  let generation = 0;
  const waiting = new Set<(outcome: Outcome) => void>();
  const settle = (outcome: Outcome) => {
    const pending = [...waiting];
    waiting.clear();
    pending.forEach((resolve) => resolve(outcome));
  };
  const cancel = () => {
    generation++;
    settle("cancelled");
  };
  return {
    cancel,
    async setup(operation: () => Promise<unknown>) {
      const ticket = generation;
      try {
        await operation();
        // Success is confirmed by update(..., "ready"), not the mutation response.
      } catch (error) {
        if (active && ticket === generation) cancel();
        throw error;
      }
    },
    activate() { active = true; },
    dispose() { active = false; cancel(); },
    update(nextSession: string | null | undefined, nextState: AccountState) {
      // undefined is Clerk still loading: learning the session on page load isn't a switch.
      if (session !== undefined && nextSession !== session) cancel();
      session = nextSession;
      state = nextState;
      if (!active) return;
      if (state === "signed-out") settle("signed-out");
      else if (state === "ready") settle("ready");
    },
    async request(): Promise<Outcome> {
      if (!active) return "cancelled";
      if (state === "signed-out") return "signed-out";
      const ticket = generation;
      // Even when ready, yield once so a sign-out in the same tick still cancels.
      const outcome = await (state === "ready" ? Promise.resolve<Outcome>("ready") : new Promise<Outcome>((resolve) => waiting.add(resolve)));
      return active && ticket === generation ? outcome : "cancelled";
    },
  };
}
