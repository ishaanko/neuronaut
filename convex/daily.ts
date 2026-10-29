import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { enqueue, GUEST_PRIORITY } from "./jobs";
import { placeOf } from "./map";
import {
  HINTS,
  LIMITS,
  addDays,
  cosine,
  dailyNumber,
  dailyPlayer,
  GPU,
  guestArg,
  guestPlayer,
  heat,
  ladderRank,
  neuronKey,
  playerFor,
  queryToday,
  SOLVE_COS,
  today,
  validNeuron,
} from "./lib";

const BUFFER_DAYS = 7; // puzzles generated ahead, so a night the GPU is off doesn't skip a day

async function dailyFor(ctx: MutationCtx | Parameters<typeof playerFor>[0], date: string) {
  return await ctx.db.query("dailies").withIndex("by_date", (q) => q.eq("date", date)).unique();
}

// When this player's clock started on a puzzle: their first open, or their first guess if that came earlier (they
// guessed before the open was recorded). Null if they've done neither.
async function startedAt(ctx: MutationCtx | Parameters<typeof playerFor>[0], playerId: Id<"players">, date: string, firstGuess?: number) {
  const open = await ctx.db.query("opens").withIndex("by_player_date", (q) => q.eq("playerId", playerId).eq("date", date)).unique();
  const times = [open?._creationTime, firstGuess].filter((x) => x !== undefined);
  return times.length ? Math.min(...times) : null;
}

export function dailyPoints(guesses: number) {
  return 10 + 2 * (LIMITS.guesses - guesses);
}

// Today's puzzle: the hidden neuron's steered replies next to the unsteered ones, hints this player has unlocked, their
// guesses (hottest first) and, once they finish, the answer. Signed out, `guest` picks the guest's own game.
export const current = query({
  args: { date: v.optional(v.string()), guest: guestArg },
  handler: async (ctx, { date, guest }) => {
    const now = await queryToday(ctx);
    const d = date ?? now;
    if (d > now) return null; // puzzles are generated days ahead; their clues stay hidden until their date
    const daily = await dailyFor(ctx, d);
    if (!daily) return null;
    const player = await playerFor(ctx, guest);
    const guesses = player
      ? await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", d)).collect()
      : [];
    const result = player
      ? await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", d)).unique()
      : null;
    const finished = !!result;
    const first = guesses.length ? Math.min(...guesses.map((g) => g._creationTime)) : undefined;
    const at = async (layer: number, n: number) => {
      const p = await placeOf(ctx, layer, n);
      return p?.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : null;
    };
    return {
      date: d,
      number: dailyNumber(d),
      // a past puzzle: playable, but it pays nothing. Guesses the mutation filed as practice count too: for the seconds
      // after midnight before the clock row moves, the page still shows yesterday's as today's
      practice: d < now || guesses.some((g) => g.practice) || !!result?.practice,
      difficulty: daily.difficulty ?? null,
      prompts: daily.prompts,
      texts: daily.texts,
      baseline: daily.baseline,
      limit: LIMITS.guesses,
      hintsAt: HINTS,
      band: guesses.length >= HINTS.band || finished ? daily.band : null,
      hint: guesses.length >= HINTS.token || finished ? daily.hint : null,
      guesses: (
        await Promise.all(
          guesses.map(async (g) => ({
            layer: g.layer,
            n: g.n,
            status: g.status,
            heat: g.heat ?? null,
            rank: g.rank ?? null,
            cos: g.cos ?? null,
            correct: g.correct ?? false,
            at: g._creationTime,
            place: await at(g.layer, g.n), // guessed neurons are visited, so their place is disclosed
          })),
        )
      ).sort((a, b) => (b.heat ?? -999) - (a.heat ?? -999)),
      startedAt: player ? await startedAt(ctx, player._id, d, first) : null,
      result: result
        ? { solved: result.solved, guesses: result.guesses, heats: result.heats, practice: !!result.practice, seconds: result.seconds ?? null }
        : null,
      answer: finished ? { layer: daily.layer, n: daily.n, place: await at(daily.layer, daily.n) } : null,
    };
  },
});

// How many played a puzzle live and how many solved it. Kept out of `current`, so another player's result reruns only
// this small query for everyone watching, not their whole daily.
export const tally = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const t = await ctx.db.query("tallies").withIndex("by_date", (q) => q.eq("date", date)).unique();
    return t ? { players: t.players, solvers: t.solvers } : await countResults(ctx, date);
  },
});

// Past puzzles, newest first, for practice: how many played each live and solved it, and how this player did.
export const archive = query({
  args: { guest: guestArg },
  handler: async (ctx, { guest }) => {
    const player = await playerFor(ctx, guest);
    const now = await queryToday(ctx);
    const past = await ctx.db.query("tallies").withIndex("by_date", (q) => q.lt("date", now)).order("desc").take(60);
    return await Promise.all(
      past.map(async (d) => {
        const mine = player
          ? await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", d.date)).unique()
          : null;
        return {
          date: d.date,
          number: dailyNumber(d.date),
          difficulty: d.difficulty ?? null,
          players: d.players,
          solvers: d.solvers,
          mine: mine ? { solved: mine.solved, guesses: mine.guesses, practice: !!mine.practice } : null,
        };
      }),
    );
  },
});

// Scores one guess against the daily: rank = how many measured neurons are closer to the answer's effect, plus one;
// heat = that rank on a 0-99 log scale (rules.ts).
async function resolve(ctx: MutationCtx, g: Doc<"guesses">, embedding: number[], daily: Doc<"dailies">) {
  const cos = cosine(embedding, daily.embedding);
  const correct = g.key === daily.key || cos >= SOLVE_COS;
  const rank = correct ? 0 : ladderRank(daily.ladder, cos);
  const total = daily.ladder.ranks[daily.ladder.ranks.length - 1] ?? 1;
  await ctx.db.patch(g._id, { status: "done", heat: correct ? 100 : heat(rank, total), rank, correct, cos: Math.round(cos * 1000) / 1000 });
  await settle(ctx, g.playerId, daily);
}

// Writes the player's result once they solve it or run out of guesses, but only after every guess up to the winning
// one has been scored: an earlier pending guess could still be the win, and its heat belongs in the result.
async function settle(ctx: MutationCtx, playerId: Doc<"players">["_id"], daily: Doc<"dailies">) {
  const existing = await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", playerId).eq("date", daily.date)).unique();
  if (existing) return;
  const gs = (await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", playerId).eq("date", daily.date)).collect())
    .sort((a, b) => a._creationTime - b._creationTime);
  const hit = gs.findIndex((g) => g.correct);
  const used = hit >= 0 ? gs.slice(0, hit + 1) : gs;
  if ((hit < 0 && gs.length < LIMITS.guesses) || used.some((g) => g.status !== "done")) return;
  const solved = hit >= 0;
  const practice = gs.some((g) => g.practice);
  // the clock stops when the last counted guess was made, not when the GPU got round to scoring it
  const start = await startedAt(ctx, playerId, daily.date, gs[0]?._creationTime);
  const seconds = start === null ? undefined : Math.round((used[used.length - 1]._creationTime - start) / 1000);
  if (!practice) await bumpTally(ctx, daily, solved, 1); // before the insert: a missing tally counts the results so far
  await ctx.db.insert("results", { playerId, date: daily.date, solved, guesses: used.length, heats: used.map((g) => g.heat ?? 0), practice, seconds });
  await reveal(ctx, playerId, daily);
  if (practice) return;
  const p = (await ctx.db.get(playerId))!;
  // A guess pending across UTC midnight can settle an older puzzle after a newer one; only the newest date moves the
  // streak (a late older win still pays, it just doesn't extend the run).
  const newest = !p.lastSolved || daily.date > p.lastSolved;
  if (solved) {
    const streak = p.lastSolved === addDays(daily.date, -1) ? p.streak + 1 : 1;
    await ctx.db.patch(playerId, {
      points: p.points + dailyPoints(used.length),
      dailySolved: p.dailySolved + 1,
      ...(newest ? { streak, bestStreak: Math.max(p.bestStreak, streak), lastSolved: daily.date } : {}),
    });
  } else if (newest) {
    await ctx.db.patch(playerId, { streak: 0 });
  }
}

// Once a player finishes, the answer becomes one of their visited neurons: its card (and its place on the map) opens up
// so they can see why each guess scored what it did. Its profile is measured if nobody has yet, at background priority
// so it doesn't spend the player's GPU budget.
async function reveal(ctx: MutationCtx, playerId: Doc<"players">["_id"], daily: Doc<"dailies">) {
  const seen = await ctx.db.query("scans").withIndex("by_player_key", (q) => q.eq("playerId", playerId).eq("key", daily.key)).first();
  if (!seen) await ctx.db.insert("scans", { playerId, key: daily.key, layer: daily.layer, n: daily.n, date: daily.date, source: "guess" });
  if (!(await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", daily.key)).unique()))
    await enqueue(ctx, "profile", `profile:${daily.key}`, { layer: daily.layer, n: daily.n }, 1);
}

// Starts this player's solve clock on a puzzle the first time they open it. A signed-out visitor with a guest token
// gets their guest row here. Signed-in users without a handle and players who already finished are ignored, so the
// page can call it on every visit.
export const open = mutation({
  args: { date: v.optional(v.string()), guest: guestArg },
  handler: async (ctx, args) => {
    const date = args.date ?? today();
    if (date > today() || !(await dailyFor(ctx, date))) return;
    const signedIn = !!(await ctx.auth.getUserIdentity());
    const player = signedIn || args.guest === undefined ? await playerFor(ctx) : await guestPlayer(ctx, args.guest);
    if (!player) return;
    const has = (t: "opens" | "results") =>
      ctx.db.query(t).withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).first();
    if (!(await has("opens")) && !(await has("results"))) await ctx.db.insert("opens", { playerId: player._id, date });
  },
});

// A guess at today's puzzle, or with `date` at a past one for practice: scored the same way, but it pays no points and
// doesn't touch the streak. Signed out, `guest` plays as that guest.
export const guess = mutation({
  args: { layer: v.number(), n: v.number(), date: v.optional(v.string()), guest: guestArg },
  handler: async (ctx, { layer, n, guest, ...args }) => {
    validNeuron(layer, n);
    const player = await dailyPlayer(ctx, guest);
    const date = args.date ?? today();
    if (date > today()) throw new ConvexError("That puzzle is not out yet");
    const practice = date < today();
    const daily = await dailyFor(ctx, date);
    if (!daily) throw new ConvexError(practice ? "No puzzle that day" : "No puzzle today yet");
    if (await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).unique())
      throw new ConvexError(`You already finished ${practice ? "that" : "today's"} neuron`);
    const key = neuronKey(layer, n);
    const gs = await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).collect();
    if (gs.some((g) => g.correct)) throw new ConvexError("Waiting for earlier guesses to finish");
    if (gs.length >= LIMITS.guesses) throw new ConvexError("Out of guesses");
    if (gs.some((g) => g.key === key)) throw new ConvexError(`Already guessed L${layer} N${n}`);
    const id = await ctx.db.insert("guesses", { playerId: player._id, date, key, layer, n, status: "pending", ...(practice ? { practice } : {}) });
    if (!(await ctx.db.query("scans").withIndex("by_player_key", (q) => q.eq("playerId", player._id).eq("key", key)).first()))
      await ctx.db.insert("scans", { playerId: player._id, key, layer, n, date, source: "guess" });
    const prof = await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (prof) return await resolve(ctx, (await ctx.db.get(id))!, prof.embedding, daily);
    if (player.guest) {
      const waiting = await ctx.db.query("guesses").withIndex("by_key_status", (q) => q.eq("key", key).eq("status", "pending")).take(GPU.waiters + 1);
      if (waiting.length > GPU.waiters) throw new ConvexError("The GPU is busy right now. Try again in a minute.");
    }
    await enqueue(ctx, "profile", `profile:${key}`, { layer, n }, player.guest ? GUEST_PRIORITY : 0, player._id);
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

// Called when the worker fails to measure a neuron: the guesses waiting on it are dropped, so the player gets them back
// (and can retry, which queues a new job) instead of the puzzle never settling.
export async function refundPending(ctx: MutationCtx, key: string) {
  const pending = await ctx.db.query("guesses").withIndex("by_key_status", (q) => q.eq("key", key).eq("status", "pending")).collect();
  for (const g of pending) {
    await ctx.db.delete(g._id);
    const daily = await dailyFor(ctx, g.date);
    if (daily) await settle(ctx, g.playerId, daily);
  }
}

async function countResults(ctx: QueryCtx, date: string) {
  const live = (await ctx.db.query("results").withIndex("by_date", (q) => q.eq("date", date)).collect()).filter((r) => !r.practice);
  return { players: live.length, solvers: live.filter((r) => r.solved).length };
}

// A puzzle's tally row. Puzzles from before tallies existed get one counted from their results, once.
async function tallyFor(ctx: MutationCtx, daily: Pick<Doc<"dailies">, "date" | "difficulty">) {
  const row = await ctx.db.query("tallies").withIndex("by_date", (q) => q.eq("date", daily.date)).unique();
  if (row) return row;
  const id = await ctx.db.insert("tallies", { date: daily.date, difficulty: daily.difficulty, ...(await countResults(ctx, daily.date)) });
  return (await ctx.db.get(id))!;
}

// Counts a live result in (by 1) or out (by -1, admin.ts removePlayer). Call it before inserting or deleting the
// result: a puzzle without a tally row yet is counted from its results first.
export async function bumpTally(ctx: MutationCtx, daily: Pick<Doc<"dailies">, "date" | "difficulty">, solved: boolean, by: 1 | -1) {
  const t = await tallyFor(ctx, daily);
  await ctx.db.patch(t._id, { players: t.players + by, solvers: t.solvers + (solved ? by : 0) });
}

// Hourly, apart from ensure so a slow count never holds up new puzzles: gives puzzles from before tallies existed
// their tally row, a few per run. It checks the dates the archive can list, which costs a few tiny reads once done.
export const countOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    let left = 10;
    for (let i = -60; i <= BUFFER_DAYS && left > 0; i++) {
      const date = addDays(today(), i);
      if (await ctx.db.query("tallies").withIndex("by_date", (q) => q.eq("date", date)).unique()) continue;
      const d = await dailyFor(ctx, date);
      if (d) {
        await tallyFor(ctx, d);
        left--;
      }
    }
  },
});

// At 00:00 UTC (and hourly, in case a run was missed): moves the clock row to the new date, so every open daily page,
// archive and scan count turns over to the new day.
async function rollClock(ctx: MutationCtx) {
  const row = await ctx.db.query("clock").first();
  if (!row) await ctx.db.insert("clock", { today: today() });
  else if (row.today !== today()) await ctx.db.patch(row._id, { today: today() });
}

export const roll = internalMutation({ args: {}, handler: rollClock });

// Hourly: queue puzzle generation for any of the next BUFFER_DAYS days that has none.
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rollClock(ctx);
    const recent = await ctx.db.query("dailies").withIndex("by_date").order("desc").take(400);
    const exclude = recent.map((d) => d.key);
    for (let i = 0; i < BUFFER_DAYS; i++) {
      const date = addDays(today(), i);
      if (!(await dailyFor(ctx, date))) await enqueue(ctx, "daily", `daily:${date}`, { date, exclude }, 1);
    }
  },
});
