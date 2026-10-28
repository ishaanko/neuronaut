import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { COVERAGE_BINS, globalStats } from "./jobs";
import { MODEL } from "./lib";

// Operator tools, run with `npx convex run admin:<name>`. Not callable from the client.

// Drops the puzzles from `from` on (with their guesses and results) so the hourly cron generates new ones.
export const resetDailies = internalMutation({
  args: { from: v.string() },
  handler: async (ctx, { from }) => {
    const ds = await ctx.db.query("dailies").withIndex("by_date", (q) => q.gte("date", from)).collect();
    for (const d of ds) {
      for (const g of await ctx.db.query("guesses").filter((q) => q.eq(q.field("date"), d.date)).collect()) await ctx.db.delete(g._id);
      for (const r of await ctx.db.query("results").withIndex("by_date", (q) => q.eq("date", d.date)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(d._id);
    }
    return ds.length;
  },
});

// The answer to a day's puzzle, for checking a puzzle by hand and for the E2E test.
export const answer = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const d = await ctx.db.query("dailies").withIndex("by_date", (q) => q.eq("date", date)).unique();
    return d ? { layer: d.layer, n: d.n } : null;
  },
});

// Deletes every player and what they did (scans, catches, guesses, results, entries), and un-catches their neurons.
// For dev deployments and for moving to a new players schema; puzzles, bounties and measured neurons stay.
export const resetPlayers = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const c of await ctx.db.query("catches").collect()) {
      const p = await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", c.key)).unique();
      if (p) await ctx.db.patch(p._id, { caught: false });
    }
    for (const t of ["scans", "catches", "guesses", "results", "entries", "players"] as const)
      for (const d of await ctx.db.query(t).collect()) {
        await ctx.db.delete(d._id);
        n++;
      }
    const s = await ctx.db.query("stats").withIndex("by_name", (q) => q.eq("name", "global")).unique();
    if (s) await ctx.db.patch(s._id, { caught: 0, coverage: s.coverage.map(() => 0) });
    return n;
  },
});

// Handles the E2E and calibration scripts sign up with. Only these can be removed one at a time.
const TEST_HANDLE = /^(e2e|calib)_/;

// Deletes one test player and everything they did, so test runs don't show on the leaderboard, the dex, the map or a
// daily's solver count. Their catches become catchable again. e2e/game.mjs calls this when it finishes.
export const removePlayer = internalMutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    if (!TEST_HANDLE.test(handle)) throw new ConvexError("This removes only test players (e2e_ or calib_ handles)");
    const p = await ctx.db.query("players").withIndex("by_handle", (q) => q.eq("handleLower", handle.toLowerCase())).unique();
    if (!p) return false;
    const catches = await ctx.db.query("catches").withIndex("by_player", (q) => q.eq("playerId", p._id)).collect();
    const s = await globalStats(ctx);
    if (s && catches.length) {
      const coverage = [...s.coverage];
      for (const c of catches) coverage[c.layer * COVERAGE_BINS + Math.floor((c.n * COVERAGE_BINS) / MODEL.width)] -= 1;
      await ctx.db.patch(s._id, { caught: s.caught - catches.length, coverage });
    }
    for (const c of catches) {
      const prof = await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", c.key)).unique();
      if (prof) await ctx.db.patch(prof._id, { caught: false });
      await ctx.db.delete(c._id);
    }
    const rows = [
      ...(await ctx.db.query("scans").withIndex("by_player", (q) => q.eq("playerId", p._id)).collect()),
      ...(await ctx.db.query("guesses").withIndex("by_player_date", (q) => q.eq("playerId", p._id)).collect()),
      ...(await ctx.db.query("results").withIndex("by_player_date", (q) => q.eq("playerId", p._id)).collect()),
      ...(await ctx.db.query("entries").withIndex("by_player_bounty", (q) => q.eq("playerId", p._id)).collect()),
      ...(await ctx.db.query("experiments").withIndex("by_player_date", (q) => q.eq("playerId", p._id)).collect()),
    ];
    for (const r of rows) await ctx.db.delete(r._id);
    // queued judge and lab jobs point at the rows just deleted. Profile jobs stay: they're shared by neuron, and
    // other players' guesses may be waiting on them.
    for (const status of ["pending", "running"] as const)
      for (const j of await ctx.db.query("jobs").withIndex("by_by_status", (q) => q.eq("by", p._id).eq("status", status)).collect())
        if (j.kind === "judge" || j.kind === "combo") await ctx.db.delete(j._id);
    await ctx.db.delete(p._id);
    return true;
  },
});
