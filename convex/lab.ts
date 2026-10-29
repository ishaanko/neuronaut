import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { enqueue } from "./jobs";
import { checkPush, playerFor, requirePlayer } from "./lib";
import { LIMITS, neuronKey, today } from "./rules";
import { push } from "./schema";

// The lab: push two neurons separately and together, and measure whether the joint effect is the sum of the two.

export const run = mutation({
  args: { a: push, b: push },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx);
    const [a, b] = [checkPush(args.a), checkPush(args.b)];
    if (neuronKey(a.layer, a.n) === neuronKey(b.layer, b.n)) throw new ConvexError("Pick two different neurons");
    const date = today();
    const done = await ctx.db.query("experiments").withIndex("by_player_date", (q) => q.eq("playerId", player._id).eq("date", date)).collect();
    if (done.length >= LIMITS.experiments) throw new ConvexError(`${LIMITS.experiments} experiments a day. More tomorrow.`);
    const id = await ctx.db.insert("experiments", { playerId: player._id, a, b, date, status: "pending" });
    await enqueue(ctx, { kind: "combo", args: { experimentId: id, a, b } }, `combo:${id}`, 0, player._id);
    return id;
  },
});

// This player's experiments, newest first. `result` is set once the worker has measured one.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const player = await playerFor(ctx);
    if (!player) return [];
    const rows = await ctx.db.query("experiments").withIndex("by_player_date", (q) => q.eq("playerId", player._id)).order("desc").take(30);
    return rows.map(({ _id, a, b, status, texts, additivity, gain, towardA, towardB, faint }) => ({
      id: _id,
      a,
      b,
      status,
      result:
        status === "done" && additivity !== undefined && gain !== undefined && towardA !== undefined && towardB !== undefined
          ? { additivity, gain, towardA, towardB, faint: !!faint, texts: texts ?? [] }
          : null,
    }));
  },
});
