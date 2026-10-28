import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { GPU, MODEL } from "./lib";

export const COVERAGE_BINS = 96;
export const GUEST_PRIORITY = 0.5; // a guest is waiting: after players (0), before background work (1)

// Queues GPU work unless the same key is already pending or running. priority 0 means a player is waiting on it.
// `by` is the player asking. New work for them is refused once they have GPU.perPlayer jobs waiting, or once GPU.queue
// players' jobs are waiting in total (GPU.guests at GUEST_PRIORITY), so nobody can flood the one GPU. The throw rolls
// back the caller's mutation, so a refused scan, guess or entry isn't used up.
export async function enqueue(
  ctx: MutationCtx,
  kind: Doc<"jobs">["kind"],
  key: string,
  args: unknown,
  priority = 0,
  by?: Id<"players">,
) {
  const open = await ctx.db
    .query("jobs")
    .withIndex("by_key", (q) => q.eq("key", key))
    .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "running")))
    .first();
  if (open) return open._id;
  if (by) {
    const mine = async (status: "pending" | "running") =>
      (await ctx.db.query("jobs").withIndex("by_by_status", (q) => q.eq("by", by).eq("status", status)).take(GPU.perPlayer)).length;
    if ((await mine("pending")) + (await mine("running")) >= GPU.perPlayer)
      throw new ConvexError("You already have a few things waiting on the GPU. Give them a moment.");
    const cap = priority === GUEST_PRIORITY ? GPU.guests : GPU.queue;
    const waiting = await ctx.db
      .query("jobs")
      .withIndex("by_status_priority", (q) => q.eq("status", "pending").eq("priority", priority))
      .take(cap);
    if (waiting.length >= cap) throw new ConvexError("The GPU is busy right now. Try again in a minute.");
  }
  return await ctx.db.insert("jobs", { kind, key, args, priority, status: "pending", by });
}

export async function globalStats(ctx: QueryCtx) {
  return await ctx.db.query("stats").withIndex("by_name", (q) => q.eq("name", "global")).unique();
}

export async function bumpStats(
  ctx: MutationCtx,
  change: { profiled?: number; caught?: { layer: number; n: number }; baseline?: { prompts: string[]; texts: string[] } },
) {
  let s = await globalStats(ctx);
  if (!s) {
    const id = await ctx.db.insert("stats", {
      name: "global",
      profiled: 0,
      caught: 0,
      coverage: new Array(MODEL.layers * COVERAGE_BINS).fill(0),
    });
    s = (await ctx.db.get(id))!;
  }
  const patch: Partial<Doc<"stats">> = {};
  if (change.baseline) Object.assign(patch, { prompts: change.baseline.prompts, baseline: change.baseline.texts });
  if (change.profiled) patch.profiled = s.profiled + change.profiled;
  if (change.caught) {
    const { layer, n } = change.caught;
    const coverage = [...s.coverage];
    coverage[layer * COVERAGE_BINS + Math.floor((n * COVERAGE_BINS) / MODEL.width)] += 1;
    patch.coverage = coverage;
    patch.caught = s.caught + 1;
  }
  await ctx.db.patch(s._id, patch);
}
