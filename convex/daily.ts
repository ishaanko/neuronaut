import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { enqueue } from "./jobs";
import {
  HINTS,
  LIMITS,
  addDays,
  cosine,
  dailyNumber,
  neuronKey,
  playerFor,
  requirePlayer,
  SOLVE_COS,
  today,
  validNeuron,
} from "./lib";

const BUFFER_DAYS = 7; // puzzles generated ahead, so a night the GPU is off doesn't skip a day

async function dailyFor(ctx: MutationCtx | Parameters<typeof playerFor>[0], date: string) {
  return await ctx.db.query("dailies").withIndex("by_date", (q) => q.eq("date", date)).unique();
}

export function dailyPoints(guesses: number) {
  return 10 + 2 * (LIMITS.guesses - guesses);
}

// Today's puzzle: the hidden neuron's steered replies next to the unsteered ones, hints this player has unlocked, their
// guesses (hottest first) and, once they finish, the answer.
export const current = query({
  args: { token: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, { token, date }) => {
    const d = date ?? today();
    const daily = await dailyFor(ctx, d);
    if (!daily) return null;
    const player = await playerFor(ctx, token);
    const guesses = player
      ? await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", d)).collect()
      : [];
    const result = player
      ? await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", d)).unique()
      : null;
    const all = await ctx.db.query("results").withIndex("by_date", (q) => q.eq("date", d)).collect();
    const finished = !!result;
    return {
      date: d,
      number: dailyNumber(d),
      prompts: daily.prompts,
      texts: daily.texts,
      baseline: daily.baseline,
      limit: LIMITS.guesses,
      hintsAt: HINTS,
      band: guesses.length >= HINTS.band || finished ? daily.band : null,
      hint: guesses.length >= HINTS.token || finished ? daily.hint : null,
      guesses: guesses
        .map((g) => ({ layer: g.layer, n: g.n, status: g.status, heat: g.heat ?? null, rank: g.rank ?? null, correct: g.correct ?? false, at: g._creationTime }))
        .sort((a, b) => (b.heat ?? -999) - (a.heat ?? -999)),
      result: result ? { solved: result.solved, guesses: result.guesses, heats: result.heats } : null,
      answer: finished ? { layer: daily.layer, n: daily.n } : null,
      players: all.length,
      solvers: all.filter((r) => r.solved).length,
    };
  },
});

// Scores one guess against the daily. heat = 100 x cosine between the two neurons' effects; rank = where it would sit
// among the answer's nearest measured neurons (null past the top 256).
async function resolve(ctx: MutationCtx, g: Doc<"guesses">, embedding: number[], daily: Doc<"dailies">) {
  const cos = cosine(embedding, daily.embedding);
  const correct = g.key === daily.key || cos >= SOLVE_COS;
  const above = daily.neighbors.filter((c) => c > cos).length;
  const rank = correct ? 0 : above < daily.neighbors.length ? above + 1 : null;
  await ctx.db.patch(g._id, { status: "done", heat: Math.round(cos * 100), rank, correct });
  await settle(ctx, g.playerId, daily);
}

// Finalize only when pending guesses cannot change the winning attempt or its heats.
async function settle(ctx: MutationCtx, playerId: Doc<"players">["_id"], daily: Doc<"dailies">) {
  const existing = await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", playerId).eq("date", daily.date)).unique();
  if (existing) return;
  const gs = (await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", playerId).eq("date", daily.date)).collect())
    .sort((a, b) => a._creationTime - b._creationTime);
  const hit = gs.findIndex((g) => g.correct);
  const used = hit >= 0 ? gs.slice(0, hit + 1) : gs;
  if ((hit < 0 && gs.length < LIMITS.guesses) || used.some((g) => g.status !== "done")) return;
  const solved = hit >= 0;
  await ctx.db.insert("results", { playerId, date: daily.date, solved, guesses: used.length, heats: used.map((g) => g.heat ?? 0) });
  const p = (await ctx.db.get(playerId))!;
  // The index orders this player's results by puzzle date, not completion time.
  const results = await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", playerId)).collect();
  let streak = 0;
  let bestStreak = p.bestStreak; // Preserve historical achievements; reconciliation is separate.
  let lastSolved: string | undefined;
  let anchorStreak: number | undefined;
  for (const r of results) {
    if (!r.solved) {
      streak = 0;
      continue;
    }
    streak = lastSolved === addDays(r.date, -1) ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    lastSolved = r.date;
    if (r.date === p.lastSolved) anchorStreak = streak;
  }
  // Operator resets can remove history without resetting aggregates. Do not
  // fabricate missing wins or erase a legacy streak; reconcile those separately.
  const canRebuild = !p.lastSolved || (anchorStreak !== undefined && anchorStreak >= p.streak);
  if (solved || canRebuild)
    await ctx.db.patch(playerId, {
      ...(solved ? { points: p.points + dailyPoints(used.length), dailySolved: p.dailySolved + 1 } : {}),
      ...(canRebuild ? { streak, bestStreak, ...(lastSolved ? { lastSolved } : {}) } : {}),
    });
}

export const guess = mutation({
  args: { token: v.string(), layer: v.number(), n: v.number() },
  handler: async (ctx, { token, layer, n }) => {
    validNeuron(layer, n);
    const player = await requirePlayer(ctx, token);
    const date = today();
    const daily = await dailyFor(ctx, date);
    if (!daily) throw new ConvexError("No puzzle today yet");
    if (await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).unique())
      throw new ConvexError("You already finished today's neuron");
    const key = neuronKey(layer, n);
    const gs = await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).collect();
    if (gs.some((g) => g.correct)) throw new ConvexError("Waiting for earlier guesses to finish");
    if (gs.length >= LIMITS.guesses) throw new ConvexError("Out of guesses");
    if (gs.some((g) => g.key === key)) throw new ConvexError(`Already guessed L${layer} N${n}`);
    const id = await ctx.db.insert("guesses", { playerId: player._id, date, key, layer, n, status: "pending" });
    if (!(await ctx.db.query("scans").withIndex("by_player_key", (q) => q.eq("playerId", player._id).eq("key", key)).first()))
      await ctx.db.insert("scans", { playerId: player._id, key, layer, n, date, source: "guess" });
    const prof = await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (prof) await resolve(ctx, (await ctx.db.get(id))!, prof.embedding, daily);
    else await enqueue(ctx, "profile", `profile:${key}`, { layer, n }, 0);
  },
});

// Called when the worker measures a neuron: scores every guess that was waiting on it.
export async function resolvePending(ctx: MutationCtx, key: string, embedding: number[]) {
  const pending = await ctx.db.query("guesses").withIndex("by_key_status", (q) => q.eq("key", key).eq("status", "pending")).collect();
  for (const g of pending) {
    const daily = await dailyFor(ctx, g.date);
    if (daily) await resolve(ctx, g, embedding, daily);
  }
}

// Hourly: queue puzzle generation for any of the next BUFFER_DAYS days that has none.
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query("dailies").withIndex("by_date").order("desc").take(400);
    const exclude = recent.map((d) => d.key);
    for (let i = 0; i < BUFFER_DAYS; i++) {
      const date = addDays(today(), i);
      if (!(await dailyFor(ctx, date))) await enqueue(ctx, "daily", `daily:${date}`, { date, exclude }, 1);
    }
  },
});
