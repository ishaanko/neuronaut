import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { BOUNTY_DAYS, BOUNTY_STAGGER_HOURS, JUDGE_PROMPTS, POOL } from "./bountyPool";
import { enqueue } from "./jobs";
import { LIMITS, playerFor, requirePlayer, validNeuron } from "./lib";
import { push } from "./schema";

const OPEN = 3; // bounties open at once
export const PRIZES = [50, 25, 10]; // points for the top three when a bounty closes; beating par adds PAR_BONUS
export const PAR_BONUS = 10;
export const DOSE = { min: 0.05, max: 1.0 };

// A bounty's public fields. Whether it's open is left to the client's clock (rules.ts bountyState).
function summary(b: Doc<"bounties">) {
  return {
    slug: b.slug,
    title: b.title,
    brief: b.brief,
    maxNeurons: b.maxNeurons,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    par: b.par?.score ?? null,
    question: b.question ?? null,
  };
}

// Each player's best finished entry, worked out from every entry. Only for bounties opened before the standings table
// (no `ranked`), until rankOld fills theirs in.
async function bestEntries(ctx: QueryCtx, b: Doc<"bounties">) {
  const entries = await ctx.db.query("entries").withIndex("by_bounty", (q) => q.eq("bountyId", b._id)).collect();
  const best = new Map<string, Doc<"entries">>();
  for (const e of entries)
    if (e.status === "done" && (best.get(e.playerId)?.score ?? -1) < (e.score ?? 0)) best.set(e.playerId, e);
  return [...best.values()];
}

type Rank = Pick<Doc<"standings">, "playerId" | "entryId" | "score" | "neurons" | "at"> & { handle?: string };
const byRank = (a: Rank, b: Rank) => b.score - a.score || a.at - b.at;

// A bounty's leaderboard, best first, at most `limit` rows: each player's best judged entry, the earlier on a tie.
async function ranking(ctx: QueryCtx, b: Doc<"bounties">, limit = Infinity): Promise<Rank[]> {
  if (!b.ranked) {
    const best = await bestEntries(ctx, b);
    const rows = best.map((e) => ({ playerId: e.playerId, entryId: e._id, score: e.score ?? 0, neurons: e.pushes.length, at: e._creationTime }));
    return rows.sort(byRank).slice(0, limit);
  }
  const q = ctx.db.query("standings").withIndex("by_bounty_score", (q) => q.eq("bountyId", b._id)).order("desc");
  return (limit === Infinity ? await q.collect() : await q.take(limit)).sort(byRank);
}

// After the worker judges an entry (worker.ts finishJudge): it becomes its player's standing if it beats their best.
export async function rankEntry(ctx: MutationCtx, entryId: Id<"entries">) {
  const e = await ctx.db.get(entryId);
  if (!e || e.status !== "done" || e.score === undefined || !Number.isFinite(e.score)) return;
  const rank = { entryId, score: e.score, neurons: e.pushes.length, at: e._creationTime };
  const row = await ctx.db
    .query("standings")
    .withIndex("by_bounty_player", (q) => q.eq("bountyId", e.bountyId).eq("playerId", e.playerId))
    .unique();
  if (!row) {
    const handle = (await ctx.db.get(e.playerId))?.handle ?? "?";
    await ctx.db.insert("standings", { bountyId: e.bountyId, playerId: e.playerId, handle, ...rank });
  } else if (rank.score > row.score || (rank.score === row.score && rank.at < row.at)) await ctx.db.patch(row._id, rank);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query("bounties").withIndex("by_ends").order("desc").take(20);
    return recent.map(summary).sort((a, b) => a.endsAt - b.endsAt);
  },
});

// One bounty: the brief, par, the leaderboard (neurons stay secret until it closes) and this player's entries. "Closed"
// here means settled, which a scheduled settle does the moment it ends: data, not the clock, so the reveal reruns this.
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const b = await ctx.db.query("bounties").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!b) return null;
    const s = summary(b);
    const closed = b.settled;
    const top = await ranking(ctx, b, 50);
    const player = await playerFor(ctx);
    const mine = player
      ? await ctx.db.query("entries").withIndex("by_player_bounty", (q) => q.eq("playerId", player._id).eq("bountyId", b._id)).collect()
      : [];
    return {
      ...s,
      parPushes: closed ? (b.par?.pushes ?? null) : null,
      promptCount: b.prompts.length, // the prompts themselves stay hidden
      leaderboard: await Promise.all(
        top.map(async (r) => {
          const e = closed ? await ctx.db.get(r.entryId) : null; // its neurons and replies show once it's settled
          return {
            handle: r.handle ?? (await ctx.db.get(r.playerId))?.handle ?? "?",
            score: r.score,
            neurons: r.neurons,
            pushes: closed ? (e?.pushes ?? []) : null,
            texts: closed ? (e?.texts ?? []) : null,
            you: !!player && r.playerId === player._id,
          };
        }),
      ),
      mine: mine
        .sort((a, b) => b._creationTime - a._creationTime)
        .map((e) => ({ pushes: e.pushes, status: e.status, score: e.score ?? null, concept: e.concept ?? null, coherence: e.coherence ?? null, texts: e.texts ?? [] })),
      entriesLeft: LIMITS.entries - mine.length,
    };
  },
});

export const submit = mutation({
  args: { slug: v.string(), pushes: v.array(push) },
  handler: async (ctx, { slug, pushes }) => {
    const player = await requirePlayer(ctx);
    const b = await ctx.db.query("bounties").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    const now = Date.now();
    if (!b || now < b.startsAt || now >= b.endsAt) throw new ConvexError("This bounty isn't open");
    if (pushes.length < 1 || pushes.length > b.maxNeurons) throw new ConvexError(`Use 1-${b.maxNeurons} neurons`);
    const keys = new Set<string>();
    for (const p of pushes) {
      validNeuron(p.layer, p.n);
      if (!Number.isFinite(p.dose) || Math.abs(p.dose) < DOSE.min || Math.abs(p.dose) > DOSE.max)
        throw new ConvexError(`Doses are ${DOSE.min} to ${DOSE.max} (or negative)`);
      keys.add(`${p.layer}:${p.n}`);
    }
    if (keys.size !== pushes.length) throw new ConvexError("Each neuron once");
    const mine = await ctx.db.query("entries").withIndex("by_player_bounty", (q) => q.eq("playerId", player._id).eq("bountyId", b._id)).collect();
    if (mine.length >= LIMITS.entries) throw new ConvexError(`Out of entries for this bounty (${LIMITS.entries})`);
    const pushesR = pushes.map((p) => ({ ...p, dose: Math.round(p.dose * 100) / 100 }));
    const entryId = await ctx.db.insert("entries", { bountyId: b._id, playerId: player._id, pushes: pushesR, status: "pending" });
    await enqueue(ctx, "judge", `judge:${entryId}`, { entryId, slug, pushes: pushesR, prompts: b.prompts, anchors: b.anchors, ...(b.question ? { question: b.question } : {}) }, 0, player._id);
  },
});

// After an entry's judgment lands: if its bounty has already ended, try to settle it now rather than at the next hour.
export async function settleIfEnded(ctx: MutationCtx, entryId: Id<"entries">) {
  const e = await ctx.db.get(entryId);
  const b = e && (await ctx.db.get(e.bountyId));
  if (b && !b.settled && b.endsAt <= Date.now()) await ctx.scheduler.runAfter(0, internal.bounties.settle, {});
}

// Hourly: keep OPEN bounties running, opening the next from the pool every BOUNTY_STAGGER_HOURS. Each new bounty gets
// a par job: the worker's own best attempt, which players try to beat.
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("bounties").collect();
    const live = all.filter((b) => b.endsAt > now);
    if (live.length >= OPEN + 1) return;
    const lastStart = Math.max(0, ...all.map((b) => b.startsAt));
    const startsAt = live.length < OPEN ? now : lastStart + BOUNTY_STAGGER_HOURS * 3600000;
    const endsAt = startsAt + BOUNTY_DAYS * 86400000;
    const next = POOL[all.length % POOL.length];
    const season = Math.floor(all.length / POOL.length);
    const slug = season ? `${next.id}-${season + 1}` : next.id;
    await ctx.db.insert("bounties", {
      slug,
      title: next.title,
      brief: next.brief,
      maxNeurons: next.maxNeurons,
      prompts: JUDGE_PROMPTS,
      anchors: next.anchors,
      question: next.question,
      startsAt,
      endsAt,
      settled: false,
      ranked: true,
    });
    await ctx.scheduler.runAt(endsAt, internal.bounties.settle, {});
    await enqueue(ctx, "par", `par:${slug}`, { slug, prompts: JUDGE_PROMPTS, anchors: next.anchors, question: next.question, maxNeurons: next.maxNeurons, brief: next.brief }, 1);
  },
});

// When a bounty ends (ensure schedules it), and hourly in case that run failed: pay out bounties that closed. One
// with entries still being judged waits for them: the last judgment (worker.ts finishJudge, fail) runs this again.
export const settle = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const closed = await ctx.db.query("bounties").withIndex("by_ends", (q) => q.lte("endsAt", now)).collect();
    for (const b of closed.filter((b) => !b.settled)) {
      const judging = await ctx.db.query("entries").withIndex("by_bounty_status", (q) => q.eq("bountyId", b._id).eq("status", "pending")).first();
      if (judging) continue;
      const top = await ranking(ctx, b);
      for (const [i, r] of top.entries()) {
        const bonus = (PRIZES[i] ?? 0) + (b.par && r.score > b.par.score ? PAR_BONUS : 0);
        if (!bonus) continue;
        const p = (await ctx.db.get(r.playerId))!;
        await ctx.db.patch(p._id, { points: p.points + bonus, bountyWins: p.bountyWins + (i === 0 ? 1 : 0) });
      }
      await ctx.db.patch(b._id, { settled: true });
    }
  },
});

// Hourly: fills in the standings of bounties opened before the standings table, a few at a time, then marks them ranked.
export const rankOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const b of (await ctx.db.query("bounties").collect()).filter((b) => !b.ranked).slice(0, 3)) {
      for (const e of await bestEntries(ctx, b)) await rankEntry(ctx, e._id);
      await ctx.db.patch(b._id, { ranked: true });
    }
  },
});
