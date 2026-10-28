/// <reference types="vite/client" />
// Game rules that are hard to see from the UI, run against the real Convex functions (validators, schema, indexes)
// through convex-test. Each test is named for the failure it catches.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PAR_BONUS, PRIZES } from "./bounties";
import { dailyPoints } from "./daily";
import { GPU, LIMITS, neuronKey } from "./rules";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-worker-secret";
const NOW = Date.parse("2026-10-27T12:00:00Z");
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.WORKER_SECRET = SECRET;
});
afterEach(() => vi.useRealTimers());

// A unit vector along axis i: two neurons with the same axis have identical effects, different axes are unrelated.
const axis = (i: number) => Array.from({ length: 256 }, (_, j) => (j === i ? 1 : 0));

function profile(layer: number, n: number, emb: number[]) {
  return { layer, n, texts: ["t"], words: ["w"], z: 5, nll: 2, distinct: 0.9, embedding: emb };
}

async function setup() {
  const t = convexTest(schema, modules);
  const player = async (name: string) => {
    const as = t.withIdentity({ tokenIdentifier: `test|${name}`, subject: name });
    await as.mutation(api.players.join, { handle: name });
    return as;
  };
  const putProfiles = (profiles: ReturnType<typeof profile>[], jobIds: Id<"jobs">[] = []) =>
    t.mutation(api.worker.putProfiles, { secret: SECRET, jobIds, profiles });
  return { t, player, putProfiles };
}

describe("accounts", () => {
  test("a signed-out caller can't scan, guess or enter", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.neurons.scan, { layer: 1, n: 1 })).rejects.toThrow("Sign in first");
    await expect(t.mutation(api.daily.guess, { layer: 1, n: 1 })).rejects.toThrow("Sign in first");
    await expect(t.mutation(api.bounties.submit, { slug: "x", pushes: [] })).rejects.toThrow("Sign in first");
  });

  test("one sign-in can't create two players", async () => {
    const { t } = await setup();
    const as = t.withIdentity({ tokenIdentifier: "test|bob" });
    await as.mutation(api.players.join, { handle: "bob" });
    await expect(as.mutation(api.players.join, { handle: "bob2" })).rejects.toThrow("already have a handle");
  });

  test("a signed-in caller without a player is told to pick a handle", async () => {
    const { t } = await setup();
    const as = t.withIdentity({ tokenIdentifier: "test|carol" });
    await expect(as.mutation(api.neurons.scan, { layer: 1, n: 1 })).rejects.toThrow("Pick a handle first");
    expect(await as.query(api.players.me, {})).toBeNull();
  });

  test("handles are unique regardless of case", async () => {
    const { t, player } = await setup();
    await player("Dana");
    await expect(t.withIdentity({ tokenIdentifier: "test|other" }).mutation(api.players.join, { handle: "dana" })).rejects.toThrow(
      "taken",
    );
  });
});

test("removing a test player takes them off every public list and frees what they caught", async () => {
  const { t, player, putProfiles } = await setup();
  await withDaily(t);
  await putProfiles([profile(5, 5, axis(0)), profile(2, 2, axis(2))]);
  const bot = await player("e2e_bot");
  const keep = await player("alice");
  await bot.mutation(api.daily.guess, { layer: 5, n: 5 });
  await bot.mutation(api.neurons.scan, { layer: 2, n: 2 });
  await bot.action(api.neurons.catchNeuron, { layer: 2, n: 2, name: "bot catch" });
  await keep.mutation(api.daily.guess, { layer: 5, n: 5 });
  await t.mutation(internal.admin.removePlayer, { handle: "e2e_bot" });
  expect((await t.query(api.players.leaderboard, {})).map((p) => p.handle)).toEqual(["alice"]);
  expect((await t.query(api.neurons.dex, { paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
  expect(await t.query(api.neurons.overview, {})).toMatchObject({ caught: 0, recent: [] });
  expect((await t.query(api.neurons.overview, {})).coverage.every((c) => c === 0)).toBe(true);
  expect(await t.query(api.daily.current, {})).toMatchObject({ players: 1, solvers: 1 });
  // the neuron is catchable again
  await keep.mutation(api.neurons.scan, { layer: 2, n: 2 });
  await expect(keep.action(api.neurons.catchNeuron, { layer: 2, n: 2, name: "mine" })).resolves.toMatchObject({ rarity: expect.any(String) });
  await expect(t.mutation(internal.admin.removePlayer, { handle: "alice" })).rejects.toThrow("only test players");
});

describe("GPU budget", () => {
  test("a player can't have more than GPU.perPlayer jobs waiting, and a refused scan isn't used up", async () => {
    const { player } = await setup();
    const alice = await player("alice");
    for (let n = 0; n < GPU.perPlayer; n++) await alice.mutation(api.neurons.scan, { layer: 1, n });
    await expect(alice.mutation(api.neurons.scan, { layer: 1, n: 99 })).rejects.toThrow("waiting on the GPU");
    expect((await alice.query(api.players.me, {}))!.scansLeft).toBe(LIMITS.scans - GPU.perPlayer);
  });

  test("past the global queue cap, new GPU work is refused for everyone", async () => {
    const { t, player } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < GPU.queue; i++) await ctx.db.insert("jobs", { kind: "profile", key: `profile:x${i}`, args: {}, priority: 0, status: "pending" });
    });
    const bob = await player("bob");
    await expect(bob.mutation(api.neurons.scan, { layer: 2, n: 2 })).rejects.toThrow("GPU is busy");
  });

  test("a scan of an already measured neuron is never refused", async () => {
    const { t, player, putProfiles } = await setup();
    await putProfiles([profile(3, 3, axis(3))]);
    await t.run(async (ctx) => {
      for (let i = 0; i < GPU.queue; i++) await ctx.db.insert("jobs", { kind: "profile", key: `profile:x${i}`, args: {}, priority: 0, status: "pending" });
    });
    const bob = await player("bob");
    await expect(bob.mutation(api.neurons.scan, { layer: 3, n: 3 })).resolves.toMatchObject({ layer: 3, n: 3 });
  });
});

describe("job queue", () => {
  test("players' jobs are handed out first, and background work one job at a time", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      for (const key of ["par:a", "par:b", "daily:c"]) await ctx.db.insert("jobs", { kind: "par", key, args: {}, priority: 1, status: "pending" });
    });
    const claim = () => t.mutation(api.worker.claim, { secret: SECRET, max: 24 });
    expect((await claim()).length).toBe(1); // one par, not all three in one batch
    await t.run((ctx) => ctx.db.insert("jobs", { kind: "profile", key: "profile:1:1", args: {}, priority: 0, status: "pending" }));
    const next = await claim();
    expect(next.map((j) => j.kind)).toEqual(["profile"]); // the player's scan jumps the remaining pars
  });
});

// Today's daily: answer L5 N5 along axis 0; the ladder says 3 neurons were measured.
async function withDaily(t: Awaited<ReturnType<typeof setup>>["t"], date = "2026-10-27") {
  await t.run(async (ctx) => {
    await ctx.db.insert("dailies", {
      date, key: neuronKey(5, 5), layer: 5, n: 5, prompts: ["p"], texts: ["x"], baseline: ["y"], embedding: axis(0),
      ladder: { ranks: [1, 2, 3], cos: [0.5, 0.2, 0] }, band: [0, 7], hint: "h",
    });
  });
}

describe("daily settlement", () => {
  test("a win waits for earlier pending guesses, and their heat goes in the result", async () => {
    const { t, player, putProfiles } = await setup();
    await withDaily(t);
    await putProfiles([profile(5, 5, axis(0))]); // the answer is measured; L1 N1 isn't yet
    const alice = await player("alice");
    await alice.mutation(api.daily.guess, { layer: 1, n: 1 }); // pending on the GPU
    await alice.mutation(api.daily.guess, { layer: 5, n: 5 }); // correct, scored at once
    expect((await alice.query(api.daily.current, {}))!.result).toBeNull(); // not settled with a pending guess before it
    await putProfiles([profile(1, 1, axis(1))]);
    const { result } = (await alice.query(api.daily.current, {}))!;
    expect(result).toMatchObject({ solved: true, guesses: 2, heats: [expect.any(Number), 100] });
    expect((await alice.query(api.players.me, {}))!.points).toBe(dailyPoints(2));
  });

  test("a failed profile job gives the guess back instead of stalling the puzzle", async () => {
    const { t, player, putProfiles } = await setup();
    await withDaily(t);
    await putProfiles([profile(5, 5, axis(0))]);
    const alice = await player("alice");
    await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
    await alice.mutation(api.daily.guess, { layer: 5, n: 5 });
    const job = await t.run((ctx) => ctx.db.query("jobs").withIndex("by_key", (q) => q.eq("key", "profile:1:1")).unique());
    await t.mutation(api.worker.fail, { secret: SECRET, id: job!._id, error: "boom" });
    const d = (await alice.query(api.daily.current, {}))!;
    expect(d.result).toMatchObject({ solved: true, guesses: 1, heats: [100] });
  });

  test("tomorrow's puzzle isn't readable today", async () => {
    const { t } = await setup();
    await withDaily(t, "2026-10-28");
    expect(await t.query(api.daily.current, { date: "2026-10-28" })).toBeNull();
  });

  test("a streak only extends on consecutive days, and a late older result doesn't reset it", async () => {
    const { t, player, putProfiles } = await setup();
    await putProfiles([profile(5, 5, axis(0))]);
    const alice = await player("alice");
    for (const date of ["2026-10-27", "2026-10-28"]) {
      vi.setSystemTime(Date.parse(date + "T12:00:00Z"));
      await withDaily(t, date);
      await alice.mutation(api.daily.guess, { layer: 5, n: 5 });
    }
    expect((await alice.query(api.players.me, {}))!.streak).toBe(2);
    // an older puzzle settling late (a loss on 10-26) must not touch the current streak
    await t.run(async (ctx) => {
      const p = (await ctx.db.query("players").first())!;
      await ctx.db.insert("dailies", {
        date: "2026-10-26", key: "9:9", layer: 9, n: 9, prompts: [], texts: [], baseline: [], embedding: axis(9),
        ladder: { ranks: [1], cos: [0] }, band: [0, 7], hint: "",
      });
      for (let i = 0; i < LIMITS.guesses; i++)
        await ctx.db.insert("guesses", { playerId: p._id, date: "2026-10-26", key: `20:${i}`, layer: 20, n: i, status: i ? "done" : "pending", heat: 1, rank: 9, correct: false });
    });
    await putProfiles([profile(20, 0, axis(20))]); // resolves the last pending 10-26 guess: a loss, settled now
    expect((await alice.query(api.players.me, {}))!.streak).toBe(2);
  });
});

describe("bounty settlement", () => {
  async function bountyWith(entries: { who: string; score: number; status?: "done" | "pending" }[], par?: number) {
    const { t, player } = await setup();
    const ids: Record<string, Id<"players">> = {};
    for (const who of new Set(entries.map((e) => e.who))) {
      await player(who);
      ids[who] = (await t.run((ctx) => ctx.db.query("players").withIndex("by_handle", (q) => q.eq("handleLower", who)).unique()))!._id;
    }
    await t.run(async (ctx) => {
      const b = await ctx.db.insert("bounties", {
        slug: "sea", title: "Sea", brief: "", maxNeurons: 1, prompts: [], anchors: [], startsAt: NOW - 8 * DAY, endsAt: NOW - DAY,
        settled: false, ...(par === undefined ? {} : { par: { score: par, pushes: [] } }),
      });
      for (const e of entries)
        await ctx.db.insert("entries", { bountyId: b, playerId: ids[e.who], pushes: [], status: e.status ?? "done", score: e.score });
    });
    const points = async () =>
      Object.fromEntries(await t.run(async (ctx) => (await ctx.db.query("players").collect()).map((p) => [p.handle, p.points])));
    return { t, points };
  }

  test("pays the top three by each player's best entry, once", async () => {
    const { t, points } = await bountyWith([
      { who: "ann", score: 300 }, { who: "ann", score: 900 }, { who: "ben", score: 800 }, { who: "cat", score: 100 }, { who: "dan", score: 50 },
    ]);
    await t.mutation(internal.bounties.settle, {});
    await t.mutation(internal.bounties.settle, {}); // hourly cron runs again: no second payout
    expect(await points()).toEqual({ ann: PRIZES[0], ben: PRIZES[1], cat: PRIZES[2], dan: 0 });
  });

  test("a tie goes to the earlier entry, and par pays only when beaten", async () => {
    const { t, points } = await bountyWith([{ who: "early", score: 500 }, { who: "late", score: 500 }], 500);
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ early: PRIZES[0], late: PRIZES[1] }); // 500 doesn't beat par 500
  });

  test("beating par adds the bonus", async () => {
    const { t, points } = await bountyWith([{ who: "ann", score: 501 }], 500);
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ ann: PRIZES[0] + PAR_BONUS });
  });

  test("a NaN score or a pending entry can't win a prize", async () => {
    const { t, points } = await bountyWith([{ who: "nan", score: NaN }, { who: "slow", score: 999, status: "pending" }, { who: "oki", score: 10 }]);
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ nan: 0, slow: 0, oki: PRIZES[0] });
  });

  test("a NaN or infinite dose is refused before it reaches the judge", async () => {
    const { t, player } = await setup();
    const ann = await player("ann");
    await t.run((ctx) =>
      ctx.db.insert("bounties", { slug: "sea", title: "Sea", brief: "", maxNeurons: 1, prompts: [], anchors: [], startsAt: NOW - DAY, endsAt: NOW + DAY, settled: false }),
    );
    for (const dose of [NaN, Infinity, -Infinity])
      await expect(ann.mutation(api.bounties.submit, { slug: "sea", pushes: [{ layer: 1, n: 1, dose }] })).rejects.toThrow("Doses are");
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  test("an open bounty isn't paid early", async () => {
    const { t, points } = await bountyWith([{ who: "ann", score: 900 }]);
    await t.run(async (ctx) => {
      const b = (await ctx.db.query("bounties").first())!;
      await ctx.db.patch(b._id, { endsAt: NOW + DAY });
    });
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ ann: 0 });
  });
});
