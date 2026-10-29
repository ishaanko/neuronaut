import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DOSE, NEW_GUESTS_PER_MINUTE, isDate, today, validNeuron } from "./rules";

// Today's UTC date, for queries. A query must not read the clock: Convex doesn't rerun it when the time changes and
// may serve its cached result, so one that calls today() keeps showing yesterday's puzzle after midnight. The clock
// row changes at 00:00 UTC (daily.ts roll), which reruns every query that read it. Mutations can call today().
export async function queryToday(ctx: QueryCtx) {
  return (await ctx.db.query("clock").first())?.today ?? today();
}

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

// Counts a new guest against this minute's NEW_GUESTS_PER_MINUTE, or refuses it.
async function admitGuest(ctx: MutationCtx) {
  const minute = Math.floor(Date.now() / 60_000);
  const row = await ctx.db.query("guestMints").first();
  if (!row) await ctx.db.insert("guestMints", { minute, count: 1 });
  else if (row.minute !== minute) await ctx.db.patch(row._id, { minute, count: 1 });
  else if (row.count >= NEW_GUESTS_PER_MINUTE)
    throw new ConvexError("Lots of new players right now. Try again in a minute, or sign in to play.");
  else await ctx.db.patch(row._id, { count: row.count + 1 });
}

// The guest row for a token, made on first use.
export async function guestPlayer(ctx: MutationCtx, guest: string) {
  if (!GUEST.test(guest)) throw new ConvexError("Bad guest token");
  const found = await guestFor(ctx, guest);
  if (found) return found;
  await admitGuest(ctx);
  const userId = `guest|${guest}`;
  const id = await ctx.db.insert("players", { handle: "guest", handleLower: userId, userId, guest: true, ...NEW_PLAYER });
  return (await ctx.db.get(id))!;
}

// Who is playing the daily: a signed-in caller's player, else (with a token) their guest row.
export async function dailyPlayer(ctx: MutationCtx, guest?: string) {
  if ((await ctx.auth.getUserIdentity()) || guest === undefined) return await requirePlayer(ctx);
  return await guestPlayer(ctx, guest);
}

// A neuron's measured profile, or null if nobody has measured it yet.
export async function profileOf(ctx: QueryCtx, key: string) {
  return await ctx.db.query("profiles").withIndex("by_key", (q) => q.eq("key", key)).unique();
}

// Rejects a date argument that isn't a real YYYY-MM-DD date.
export function checkDate(date: string) {
  if (!isDate(date)) throw new ConvexError(`No such date: ${date}`);
}

// Checks a player's push (bounty entry, lab experiment) and rounds its dose to hundredths, as it's stored.
export function checkPush<P extends { layer: number; n: number; dose: number }>(p: P): P {
  validNeuron(p.layer, p.n);
  if (!Number.isFinite(p.dose) || Math.abs(p.dose) < DOSE.min || Math.abs(p.dose) > DOSE.max)
    throw new ConvexError(`Doses are ${DOSE.min} to ${DOSE.max} (or negative)`);
  return { ...p, dose: Math.round(p.dose * 100) / 100 };
}

export function checkWorker(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) throw new ConvexError("bad worker secret");
}
