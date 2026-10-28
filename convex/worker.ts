import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { refundPending, resolvePending } from "./daily";
import { bumpStats, globalStats } from "./jobs";
import { checkWorker, neuronKey, rarity, today } from "./lib";
import { ladder, push } from "./schema";

// The GPU worker's API (worker/main.py). Every call carries WORKER_SECRET.

const STALE_MS = 10 * 60 * 1000; // a running job older than this is assumed lost and handed out again

const profile = v.object({
  layer: v.number(),
  n: v.number(),
  texts: v.array(v.string()),
  words: v.array(v.string()),
  z: v.number(),
  nll: v.number(),
  distinct: v.number(),
  embedding: v.array(v.float64()),
});

// How many jobs are waiting; the worker subscribes to this instead of polling.
export const pending = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkWorker(secret);
    return (await ctx.db.query("jobs").withIndex("by_status_priority", (q) => q.eq("status", "pending")).take(100)).length;
  },
});

export const claim = mutation({
  args: { secret: v.string(), max: v.number() },
  handler: async (ctx, { secret, max }) => {
    checkWorker(secret);
    const now = Date.now();
    for (const j of await ctx.db.query("jobs").withIndex("by_status_priority", (q) => q.eq("status", "running")).collect())
      if ((j.startedAt ?? 0) < now - STALE_MS) await ctx.db.patch(j._id, { status: "pending" });
    // Jobs someone is waiting on (players at 0, then guests) first, up to `max`. With none waiting, one background job:
    // a par search takes minutes, so a player who asks meanwhile waits behind at most one.
    const pending = await ctx.db.query("jobs").withIndex("by_status_priority", (q) => q.eq("status", "pending")).take(max);
    const jobs = pending[0]?.priority < 1 ? pending.filter((j) => j.priority < 1) : pending.slice(0, 1);
    for (const j of jobs) await ctx.db.patch(j._id, { status: "running", startedAt: now });
    return jobs.map((j) => ({ id: j._id, kind: j.kind, args: j.args }));
  },
});

export const fail = mutation({
  args: { secret: v.string(), id: v.id("jobs"), error: v.string() },
  handler: async (ctx, { secret, id, error }) => {
    checkWorker(secret);
    const job = await ctx.db.get(id);
    if (!job) return;
    await ctx.db.patch(id, { status: "failed", error: error.slice(0, 2000) });
    if (job.kind === "judge") await ctx.db.patch(job.args.entryId as Id<"entries">, { status: "failed" });
    if (job.kind === "combo") await ctx.db.patch(job.args.experimentId as Id<"experiments">, { status: "failed" });
    if (job.kind === "profile") await refundPending(ctx, neuronKey(job.args.layer as number, job.args.n as number));
  },
});

// Stores measured neurons (from jobs or the sweep), scores guesses that were waiting on them, closes the jobs.
export const putProfiles = mutation({
  args: { secret: v.string(), jobIds: v.array(v.id("jobs")), profiles: v.array(profile) },
  handler: async (ctx, { secret, jobIds, profiles }) => {
    checkWorker(secret);
    let added = 0;
    for (const p of profiles) {
      const key = neuronKey(p.layer, p.n);
      if (await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", key)).unique()) continue;
      await ctx.db.insert("profiles", { ...p, key, rarity: rarity(p.z, p.nll, p.distinct), caught: false });
      await resolvePending(ctx, key, p.embedding);
      added++;
    }
    if (added) await bumpStats(ctx, { profiled: added });
    for (const id of jobIds) await ctx.db.patch(id, { status: "done" });
    return added;
  },
});

// A lab experiment's result (lab.ts run).
export const finishCombo = mutation({
  args: {
    secret: v.string(),
    id: v.id("jobs"),
    experimentId: v.id("experiments"),
    texts: v.array(v.string()),
    additivity: v.number(),
    gain: v.number(),
    towardA: v.number(),
    towardB: v.number(),
    faint: v.optional(v.boolean()),
  },
  handler: async (ctx, { secret, id, experimentId, ...result }) => {
    checkWorker(secret);
    if (!(await ctx.db.get(id))) return; // admin:removePlayer deleted the job (and its row) while it ran
    await ctx.db.patch(experimentId, { status: "done", ...result });
    await ctx.db.patch(id, { status: "done" });
  },
});

export const putBaseline = mutation({
  args: { secret: v.string(), prompts: v.array(v.string()), texts: v.array(v.string()) },
  handler: async (ctx, { secret, prompts, texts }) => {
    checkWorker(secret);
    await bumpStats(ctx, { baseline: { prompts, texts } });
  },
});

export const finishJudge = mutation({
  args: {
    secret: v.string(),
    id: v.id("jobs"),
    entryId: v.id("entries"),
    score: v.number(),
    concept: v.number(),
    coherence: v.number(),
    texts: v.array(v.string()),
  },
  handler: async (ctx, { secret, id, entryId, ...result }) => {
    checkWorker(secret);
    if (!(await ctx.db.get(id))) return; // admin:removePlayer deleted the job (and its row) while it ran
    await ctx.db.patch(entryId, { status: "done", ...result });
    await ctx.db.patch(id, { status: "done" });
  },
});

export const putPar = mutation({
  args: { secret: v.string(), id: v.id("jobs"), slug: v.string(), score: v.number(), pushes: v.array(push) },
  handler: async (ctx, { secret, id, slug, score, pushes }) => {
    checkWorker(secret);
    const b = await ctx.db.query("bounties").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (b) await ctx.db.patch(b._id, { par: { score, pushes } });
    await ctx.db.patch(id, { status: "done" });
  },
});

const dailyArgs = {
  id: v.id("jobs"),
  date: v.string(),
  layer: v.number(),
  n: v.number(),
  prompts: v.array(v.string()),
  texts: v.array(v.string()),
  baseline: v.array(v.string()),
  embedding: v.array(v.float64()),
  band: v.array(v.number()),
  hint: v.string(),
  difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"))),
};

// Stores a generated puzzle. The worker computes its ladder against the full sweep, which only it holds.
export const putDaily = mutation({
  args: { secret: v.string(), ...dailyArgs, ladder },
  handler: async (ctx, { secret, id, ...d }) => {
    checkWorker(secret);
    if (!(await ctx.db.query("dailies").withIndex("by_date", (q) => q.eq("date", d.date)).unique()))
      await ctx.db.insert("dailies", { ...d, key: neuronKey(d.layer, d.n) });
    await ctx.db.patch(id, { status: "done" });
  },
});

// Today's and future puzzles, so the worker can recompute their ladders as the sweep fills in.
export const upcomingDailies = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkWorker(secret);
    const ds = await ctx.db.query("dailies").withIndex("by_date", (q) => q.gte("date", today())).collect();
    return ds.map((d) => ({ id: d._id, layer: d.layer, n: d.n, embedding: d.embedding }));
  },
});

export const setLadder = mutation({
  args: { secret: v.string(), id: v.id("dailies"), ladder },
  handler: async (ctx, { secret, id, ladder }) => {
    checkWorker(secret);
    await ctx.db.patch(id, { ladder });
  },
});

// How many neurons the sweep has measured, for the dex header.
export const putSwept = mutation({
  args: { secret: v.string(), swept: v.number() },
  handler: async (ctx, { secret, swept }) => {
    checkWorker(secret);
    const s = await globalStats(ctx);
    if (s) await ctx.db.patch(s._id, { swept });
  },
});
