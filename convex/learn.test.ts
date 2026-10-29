/// <reference types="vite/client" />
// The learning loop: the behavior map, predictions before a scan, explained heat and practice puzzles. Each test is
// named for the failure it catches.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { dailyPoints } from "./daily";
import { LIMITS, PREDICT_POINTS, neuronKey } from "./rules";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-worker-secret";
const NOW = Date.parse("2026-10-28T12:00:00Z");
const axis = (i: number) => Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0));
const profile = (layer: number, n: number, emb: number[]) => ({ layer, n, texts: ["t"], words: ["w"], z: 5, nll: 2, distinct: 0.9, embedding: emb });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.WORKER_SECRET = SECRET;
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const player = async (name: string) => {
    const as = t.withIdentity({ tokenIdentifier: `test|${name}` });
    await as.mutation(api.players.join, { handle: name });
    return as;
  };
  const place = (layer: number, n: number, p: Partial<Doc<"places">> = {}) =>
    t.run((ctx) => ctx.db.insert("places", { layer, n, effect: "word", zone: "words", x: 0.5, y: 0.5, cell: 1200, r: 0.5, ...p }));
  const daily = (date: string, answer = [5, 5]) =>
    t.run((ctx) =>
      ctx.db.insert("dailies", {
        date, key: neuronKey(answer[0], answer[1]), layer: answer[0], n: answer[1], prompts: ["p"], texts: ["x"], baseline: ["y"],
        embedding: axis(0), ladder: { ranks: [1, 2, 3], cos: [0.5, 0.2, 0] }, band: [0, 7], hint: "h",
      }),
    );
  const putProfiles = (profiles: ReturnType<typeof profile>[]) => t.mutation(api.worker.putProfiles, { secret: SECRET, jobIds: [], profiles });
  return { t, player, place, daily, putProfiles };
}

test("the map shows a neuron's place only to players who visited it, and caught neurons to everyone", async () => {
  const { t, player, place, putProfiles } = await setup();
  await place(1, 1);
  await place(2, 2);
  await putProfiles([profile(2, 2, axis(2))]);
  const alice = await player("alice");
  const bob = await player("bob");
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1 });
  await alice.mutation(api.neurons.scan, { layer: 2, n: 2 });
  await alice.action(api.neurons.catchNeuron, { layer: 2, n: 2, name: "two" });
  expect((await alice.query(api.map.mine, {})).map((p) => p.n).sort()).toEqual([1, 2]);
  expect(await bob.query(api.map.mine, {})).toEqual([]);
  for (const viewer of [bob, t]) expect((await viewer.query(api.map.caught, {})).map((p) => p.n)).toEqual([2]);
  // the card follows the same rule: an unvisited, uncaught neuron's effect and place stay hidden
  expect(await bob.query(api.neurons.card, { layer: 1, n: 1 })).toMatchObject({ effect: null, place: null });
  expect(await alice.query(api.neurons.card, { layer: 1, n: 1 })).toMatchObject({ effect: "word", place: { zone: "words" } });
});

test("a right prediction pays once, a wrong one pays nothing, and a neuron with no place is quiet", async () => {
  const { t, player, place } = await setup();
  await place(1, 1, { effect: "breaks" });
  const alice = await player("alice");
  expect(await alice.mutation(api.neurons.scan, { layer: 1, n: 1, prediction: "breaks" })).toMatchObject({ right: true, effect: "breaks" });
  expect(await alice.mutation(api.neurons.scan, { layer: 1, n: 1, prediction: "breaks" })).toMatchObject({ right: true }); // rescan: no second payout
  expect(await alice.mutation(api.neurons.scan, { layer: 3, n: 3, prediction: "word" })).toMatchObject({ right: false, effect: "quiet" });
  expect(await alice.query(api.players.me, {})).toMatchObject({ points: PREDICT_POINTS, predicted: 2, predictedRight: 1 });
  const scans = await t.run((ctx) => ctx.db.query("scans").collect());
  expect(scans.map((s) => [s.n, s.prediction, s.right])).toEqual([[1, "breaks", true], [3, "word", false]]);
});

test("scanning here picks a placed neuron from that map square, one the player hasn't visited", async () => {
  const { player, place } = await setup();
  await place(1, 1, { cell: 7, r: 0.2 });
  await place(1, 2, { cell: 7, r: 0.9 });
  await place(1, 3, { cell: 8, r: 0.5 });
  const alice = await player("alice");
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1 });
  for (let i = 0; i < 5; i++) expect(await alice.mutation(api.map.here, { cell: 7 })).toEqual({ layer: 1, n: 2 });
  await alice.mutation(api.neurons.scan, { layer: 1, n: 2 });
  expect(await alice.mutation(api.map.here, { cell: 7 })).toBeNull(); // nothing new left in that square
});

test("a guess keeps its cosine, and finishing reveals the answer's card and queues its profile", async () => {
  const { t, player, daily, putProfiles } = await setup();
  await daily("2026-10-28");
  await putProfiles([profile(1, 1, axis(1)), profile(5, 5, axis(0))]);
  const alice = await player("alice");
  await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
  const d = (await alice.query(api.daily.current, {}))!;
  expect(d.guesses[0].cos).toBe(0);
  await alice.mutation(api.daily.guess, { layer: 5, n: 5 });
  expect((await alice.query(api.neurons.card, { layer: 5, n: 5 })).scanned).toBe(true);
  // an answer nobody has measured into Convex yet: finishing asks the worker for it, without spending the player's GPU budget
  await daily("2026-10-27", [9, 9]);
  for (let i = 0; i < 15; i++) await t.run((ctx) => ctx.db.insert("profiles", { ...profile(20, i, axis(3)), key: `20:${i}`, rarity: "rare", caught: false }));
  for (let i = 0; i < 15; i++) await alice.mutation(api.daily.guess, { layer: 20, n: i, date: "2026-10-27" });
  const job = await t.run((ctx) => ctx.db.query("jobs").withIndex("by_key", (q) => q.eq("key", "profile:9:9")).unique());
  expect(job && { status: job.status, by: job.by, priority: job.priority }).toEqual({ status: "pending", by: undefined, priority: 1 });
});

test("a practice puzzle scores like the real one but pays nothing and leaves the streak alone", async () => {
  const { t, player, daily, putProfiles } = await setup();
  await daily("2026-10-27");
  await daily("2026-10-28");
  await putProfiles([profile(5, 5, axis(0))]);
  const alice = await player("alice");
  await alice.mutation(api.daily.guess, { layer: 5, n: 5 }); // today's, for real
  const live = (await alice.query(api.players.me, {}))!;
  expect(live).toMatchObject({ points: dailyPoints(1), streak: 1 });
  await alice.mutation(api.daily.guess, { layer: 5, n: 5, date: "2026-10-27" });
  expect((await alice.query(api.daily.current, { date: "2026-10-27" }))!.result).toMatchObject({ solved: true, practice: true });
  expect(await alice.query(api.players.me, {})).toMatchObject({ points: live.points, streak: 1, dailySolved: 1 });
  await expect(alice.mutation(api.daily.guess, { layer: 1, n: 1, date: "2026-10-27" })).rejects.toThrow("already finished");
  await expect(alice.mutation(api.daily.guess, { layer: 1, n: 1, date: "2026-10-29" })).rejects.toThrow("not out yet");
  // practice results don't count toward a past day's players and solvers
  expect(await t.query(api.daily.tally, { date: "2026-10-27" })).toEqual({ players: 0, solvers: 0 });
});

test("a lab experiment queues one GPU job for its player, and only the worker can finish it", async () => {
  const { t, player } = await setup();
  const alice = await player("alice");
  const bob = await player("bob");
  const a = { layer: 20, n: 1, dose: 0.6 };
  const b = { layer: 21, n: 2, dose: 0.6 };
  await alice.mutation(api.lab.run, { a, b });
  const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.kind === "combo")!;
  expect(job.by).toBeDefined();
  const result = { texts: ["both"], additivity: 0.93, gain: 0.8, towardA: 0.7, towardB: 0.6 };
  await expect(bob.mutation(api.worker.finishCombo, { secret: "wrong", id: job._id, experimentId: job.args.experimentId, ...result })).rejects.toThrow("bad worker secret");
  await t.mutation(api.worker.finishCombo, { secret: SECRET, id: job._id, experimentId: job.args.experimentId, ...result });
  expect(await alice.query(api.lab.mine, {})).toMatchObject([{ a, b, status: "done", result: { additivity: 0.93 } }]);
  expect(await bob.query(api.lab.mine, {})).toEqual([]);
});

test("the lab refuses one neuron twice, a non-finite or out-of-range dose, and more than its daily limit", async () => {
  const { t, player } = await setup();
  const alice = await player("alice");
  const p = (n: number, dose = 0.5) => ({ layer: 10, n, dose });
  await expect(alice.mutation(api.lab.run, { a: p(1), b: p(1) })).rejects.toThrow("two different neurons");
  await expect(alice.mutation(api.lab.run, { a: p(1, NaN), b: p(2) })).rejects.toThrow("Doses are");
  await expect(alice.mutation(api.lab.run, { a: p(1, 3), b: p(2) })).rejects.toThrow("Doses are");
  for (let i = 0; i < LIMITS.experiments; i++) {
    await alice.mutation(api.lab.run, { a: p(100 + i), b: p(200 + i) });
    // the worker finishes each one, so the per-player GPU cap isn't what refuses the last
    for (const j of await t.run((ctx) => ctx.db.query("jobs").filter((q) => q.eq(q.field("status"), "pending")).collect()))
      if (j.kind === "combo") await t.mutation(api.worker.finishCombo, { secret: SECRET, id: j._id, experimentId: j.args.experimentId, texts: [], additivity: 1, gain: 1, towardA: 1, towardB: 1 });
  }
  await expect(alice.mutation(api.lab.run, { a: p(1), b: p(2) })).rejects.toThrow("experiments a day");
});
