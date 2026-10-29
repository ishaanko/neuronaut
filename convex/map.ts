import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { playerFor, requirePlayer } from "./lib";
import { type Effect, neuronKey } from "./rules";

// The behavior map (worker/places.py): strong neurons laid out by what pushing them does, so neighbours act alike.
// A neuron's place is disclosed under the card's rule: once this player has visited it, or anyone has caught it.

export async function placeOf(ctx: QueryCtx, layer: number, n: number) {
  return await ctx.db.query("places").withIndex("by_ln", (q) => q.eq("layer", layer).eq("n", n)).unique();
}

// No place row: too faint to place, which is the "quiet" effect.
export const effectOf = (p: Doc<"places"> | null): Effect => p?.effect ?? "quiet";

const dot = (p: Doc<"places"> | null) => (p?.x === undefined || p.y === undefined ? null : { x: p.x, y: p.y, zone: p.zone ?? "" });

// Every placed neuron this player has scanned or guessed.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const player = await playerFor(ctx);
    if (!player) return [];
    const scans = await ctx.db.query("scans").withIndex("by_player", (q) => q.eq("playerId", player._id)).collect();
    const rows = await Promise.all(
      scans.map(async (s) => {
        const p = await placeOf(ctx, s.layer, s.n);
        const d = dot(p);
        return d && { layer: s.layer, n: s.n, ...d, effect: effectOf(p), source: s.source };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

// Every caught neuron that has a place, for everyone.
export const caught = query({
  args: {},
  handler: async (ctx) => {
    const catches = await ctx.db.query("catches").order("desc").take(2000);
    const rows = await Promise.all(
      catches.map(async (c) => {
        const d = dot(await placeOf(ctx, c.layer, c.n));
        return d && { layer: c.layer, n: c.n, ...d, name: c.name, rarity: c.rarity };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

// A random placed neuron in one map square that this player hasn't visited yet, to scan next; null if none are left.
// It tells the player which square a neuron is in, which the square's zone already says, and nothing about its card.
export const here = mutation({
  args: { cell: v.number() },
  handler: async (ctx, { cell }) => {
    if (!Number.isInteger(cell) || cell < 0) throw new ConvexError("No such square on the map");
    const player = await requirePlayer(ctx);
    const from = Math.random();
    const after = await ctx.db.query("places").withIndex("by_cell_r", (q) => q.eq("cell", cell).gte("r", from)).take(32);
    const before = await ctx.db.query("places").withIndex("by_cell_r", (q) => q.eq("cell", cell).lt("r", from)).take(32);
    for (const p of [...after, ...before]) {
      const seen = await ctx.db
        .query("scans")
        .withIndex("by_player_key", (q) => q.eq("playerId", player._id).eq("key", neuronKey(p.layer, p.n)))
        .first();
      if (!seen) return { layer: p.layer, n: p.n };
    }
    return null;
  },
});
