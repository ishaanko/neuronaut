import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

// A puzzle as the daily page gets it (convex/daily.ts current), one of the player's guesses at it, and how it went once
// they finished.
export type Puzzle = NonNullable<FunctionReturnType<typeof api.daily.current>>;
export type Guess = Puzzle["guesses"][number];
export type Result = NonNullable<Puzzle["result"]>;
