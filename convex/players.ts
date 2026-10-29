import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { NEW_PLAYER, guestArg, guestFor, playerFor, queryToday } from "./lib";
import { LIMITS } from "./rules";

// A signed-in Clerk user picks a handle once; that makes them a player. With `guest`, the guest row they played on
// becomes that player, keeping its guesses, results, points and streak.
export const join = mutation({
  args: { handle: v.string(), guest: guestArg },
  handler: async (ctx, { handle, guest }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new ConvexError("Sign in first");
    if (await playerFor(ctx)) throw new ConvexError("You already have a handle");
    const h = handle.trim();
    if (!/^[A-Za-z0-9_-]{3,16}$/.test(h)) throw new ConvexError("Handles are 3-16 letters, digits, _ or -");
    const taken = await ctx.db.query("players").withIndex("by_handle", (q) => q.eq("handleLower", h.toLowerCase())).unique();
    if (taken) throw new ConvexError(`${h} is taken`);
    const account = { handle: h, handleLower: h.toLowerCase(), userId: id.tokenIdentifier };
    const was = await guestFor(ctx, guest);
    if (was) await ctx.db.patch(was._id, { ...account, guest: undefined });
    else await ctx.db.insert("players", { ...account, ...NEW_PLAYER });
    return h;
  },
});

// The signed-in player with what they have left today.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const p = await playerFor(ctx);
    if (!p) return null;
    const date = await queryToday(ctx);
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_player_date", (q) => q.eq("playerId", p._id).eq("date", date))
      .collect();
    const catches = await ctx.db
      .query("catches")
      .withIndex("by_player_date", (q) => q.eq("playerId", p._id).eq("date", date))
      .collect();
    return {
      _id: p._id,
      handle: p.handle,
      points: p.points,
      caught: p.caught,
      streak: p.streak,
      dailySolved: p.dailySolved,
      predicted: p.predicted ?? 0,
      predictedRight: p.predictedRight ?? 0,
      scansLeft: LIMITS.scans - scans.filter((s) => s.source === "scan").length,
      catchesLeft: LIMITS.catches - catches.length,
    };
  },
});

export const leaderboard = query({
  args: {},
  handler: async (ctx) => {
    const top = await ctx.db
      .query("players")
      .withIndex("by_guest_points", (q) => q.eq("guest", undefined))
      .order("desc")
      .take(100);
    return top.map((p) => ({
      handle: p.handle,
      points: p.points,
      caught: p.caught,
      dailySolved: p.dailySolved,
      streak: p.streak,
      bestStreak: p.bestStreak,
      bountyWins: p.bountyWins,
    }));
  },
});

export const profile = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const p = await ctx.db.query("players").withIndex("by_handle", (q) => q.eq("handleLower", handle.toLowerCase())).unique();
    if (!p || p.guest) return null;
    const catches = await ctx.db.query("catches").withIndex("by_player", (q) => q.eq("playerId", p._id)).order("desc").collect();
    return {
      handle: p.handle,
      points: p.points,
      dailySolved: p.dailySolved,
      streak: p.streak,
      bestStreak: p.bestStreak,
      bountyWins: p.bountyWins,
      predicted: p.predicted ?? 0,
      predictedRight: p.predictedRight ?? 0,
      catches: catches.map((c) => ({ layer: c.layer, n: c.n, name: c.name, rarity: c.rarity, points: c.points, date: c.date })),
    };
  },
});
