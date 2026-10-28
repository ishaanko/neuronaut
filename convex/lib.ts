import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export * from "./rules";

// Guests play the daily without an account. A random token kept in their browser names a hidden player row (userId
// "guest|<token>", flagged `guest`): it never shows on the leaderboard or a trainer page, and signing up turns it into
// the account's player (players.join), so what they played carries over. Every other mode needs an account.
export const guestArg = v.optional(v.string());
const GUEST = /^[A-Za-z0-9_-]{16,64}$/;

async function byUser(ctx: QueryCtx, userId: string) {
  return await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

// The guest row for a token, or null if the token is malformed or hasn't played yet.
export async function guestFor(ctx: QueryCtx, guest?: string) {
  return guest !== undefined && GUEST.test(guest) ? await byUser(ctx, `guest|${guest}`) : null;
}

// The caller's player, or null if they're signed out or haven't picked a handle yet. Pass `guest` where guests may
// play: a signed-out caller with a guest token gets their guest row. A signed-in caller never does.
export async function playerFor(ctx: QueryCtx, guest?: string) {
  const id = await ctx.auth.getUserIdentity();
  return id ? await byUser(ctx, id.tokenIdentifier) : await guestFor(ctx, guest);
}

export async function requirePlayer(ctx: QueryCtx) {
  if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Sign in first");
  const p = await playerFor(ctx);
  if (!p) throw new ConvexError("Pick a handle first");
  return p;
}

export const NEW_PLAYER = { points: 0, caught: 0, dailySolved: 0, streak: 0, bestStreak: 0, bountyWins: 0 };

// The guest row for a token, made on first use.
export async function guestPlayer(ctx: MutationCtx, guest: string) {
  if (!GUEST.test(guest)) throw new ConvexError("Bad guest token");
  const found = await guestFor(ctx, guest);
  if (found) return found;
  const userId = `guest|${guest}`;
  const id = await ctx.db.insert("players", { handle: "guest", handleLower: userId, userId, guest: true, ...NEW_PLAYER });
  return (await ctx.db.get(id))!;
}

// Who is playing the daily: a signed-in caller's player, else (with a token) their guest row.
export async function dailyPlayer(ctx: MutationCtx, guest?: string) {
  if ((await ctx.auth.getUserIdentity()) || guest === undefined) return await requirePlayer(ctx);
  return await guestPlayer(ctx, guest);
}

export function checkWorker(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) throw new ConvexError("bad worker secret");
}
