import { getFunctionName } from "convex/server";
export const state = {
  sessionId: "alice", authenticated: true, loading: false,
  me: null as unknown,
  queries: {} as Record<string, unknown>,
  join: (_args: unknown): Promise<unknown> => Promise.resolve(),
  signIns: 0, signOuts: 0,
};
const clerk = { openSignIn: () => { state.signIns++; }, signOut: async () => { state.signOuts++; } };
export const useAuth = () => ({ sessionId: state.sessionId });
export const useClerk = () => clerk;
export const useConvexAuth = () => ({ isAuthenticated: state.authenticated, isLoading: state.loading });
export const useMutation = () => (args: unknown) => state.join(args);
export const useQuery = (reference: Parameters<typeof getFunctionName>[0], args?: unknown) => {
  if (args === "skip") return undefined;
  return getFunctionName(reference) === "players:me" ? state.me : state.queries[getFunctionName(reference)];
};
