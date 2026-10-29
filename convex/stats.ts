import type { MutationCtx, QueryCtx } from "./_generated/server";
import { MODEL } from "./rules";

// The one "global" stats row: catch totals, the dex coverage grid (layers x COVERAGE_BINS catch counts), and the profile
// prompts with the unsteered model's replies to them, which every card compares against.

const COVERAGE_BINS = 96;

export async function globalStats(ctx: QueryCtx) {
  return await ctx.db.query("stats").withIndex("by_name", (q) => q.eq("name", "global")).unique();
}

async function statsRow(ctx: MutationCtx) {
  const s = await globalStats(ctx);
  if (s) return s;
  const id = await ctx.db.insert("stats", { name: "global", profiled: 0, caught: 0, coverage: new Array(MODEL.layers * COVERAGE_BINS).fill(0) });
  return (await ctx.db.get(id))!;
}

// Counts caught neurons in (by 1) or out (by -1, admin.ts removePlayer).
export async function countCatches(ctx: MutationCtx, catches: { layer: number; n: number }[], by: 1 | -1) {
  const s = await statsRow(ctx);
  const coverage = [...s.coverage];
  for (const { layer, n } of catches) coverage[layer * COVERAGE_BINS + Math.floor((n * COVERAGE_BINS) / MODEL.width)] += by;
  await ctx.db.patch(s._id, { coverage, caught: s.caught + by * catches.length });
}

export async function setBaseline(ctx: MutationCtx, prompts: string[], texts: string[]) {
  await ctx.db.patch((await statsRow(ctx))._id, { prompts, baseline: texts });
}
