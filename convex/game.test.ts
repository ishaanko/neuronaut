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
  expect(await t.query(api.daily.tally, { date: "2026-10-27" })).toEqual({ players: 1, solvers: 1 }); // the bot's solve counted out
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

  test("guests minting fresh tokens fill only the guests' queue, never the one players with accounts use", async () => {
    const { t, player } = await setup();
    await withDaily(t);
    for (let i = 0; i < GPU.guests; i++) await t.mutation(api.daily.guess, { layer: 1, n: i, guest: `guest-token-${i}`.padEnd(16, "x") });
    await expect(t.mutation(api.daily.guess, { layer: 2, n: 0, guest: "one-more-guest-token" })).rejects.toThrow("GPU is busy");
    const bob = await player("bob");
    await expect(bob.mutation(api.neurons.scan, { layer: 2, n: 2 })).resolves.toMatchObject({ layer: 2, n: 2 });
  });

  test("guests' jobs never ride in a player's batch; a player waiting on a guest's job moves it up, within her budget", async () => {
    const { t, player } = await setup();
    await withDaily(t);
    for (let i = 0; i < 3; i++) await t.mutation(api.daily.guess, { layer: 1, n: i, guest: `guest-token-${i}`.padEnd(16, "x") });
    const alice = await player("alice");
    await alice.mutation(api.neurons.scan, { layer: 1, n: 0 }); // the neuron guest 0 is already waiting on
    await alice.mutation(api.neurons.scan, { layer: 2, n: 2 });
    for (let n = 3; n < GPU.perPlayer + 1; n++) await alice.mutation(api.neurons.scan, { layer: 3, n });
    // her budget is spent, so she can't promote another guest's job past it
    await expect(alice.mutation(api.neurons.scan, { layer: 1, n: 1 })).rejects.toThrow("waiting on the GPU");
    const claim = () => t.mutation(api.worker.claim, { secret: SECRET, max: 24 });
    expect((await claim()).map((j) => j.args)).toEqual([{ layer: 1, n: 0 }, { layer: 2, n: 2 }, { layer: 3, n: 3 }, { layer: 3, n: 4 }]);
    expect((await claim()).map((j) => j.args)).toEqual([{ layer: 1, n: 1 }, { layer: 1, n: 2 }]);
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

  test("players and solvers count each live result once, even on a puzzle from before tallies existed", async () => {
    const { t, player, putProfiles } = await setup();
    await withDaily(t, "2026-10-26");
    await withDaily(t);
    await putProfiles([profile(5, 5, axis(0))]);
    const early = (await (await player("early")).query(api.players.me, {}))!;
    // written before tallies: today has no tally row yet, so the first new result has to count this one too
    await t.run((ctx) => ctx.db.insert("results", { playerId: early._id, date: "2026-10-27", solved: false, guesses: 15, heats: [] }));
    const alice = await player("alice");
    await alice.mutation(api.daily.guess, { layer: 5, n: 5 });
    await alice.mutation(api.daily.guess, { layer: 5, n: 5, date: "2026-10-26" }); // practice doesn't count
    expect(await t.query(api.daily.tally, { date: "2026-10-27" })).toEqual({ players: 2, solvers: 1 });
    await t.mutation(internal.daily.countOld, {}); // gives the old puzzle its tally row, so the archive lists it
    const past = await alice.query(api.daily.archive, {});
    expect(past).toMatchObject([{ date: "2026-10-26", players: 0, solvers: 0, mine: { solved: true, practice: true } }]);
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

  test("solve time runs from first opening the puzzle to the winning guess, not to when the GPU scored it", async () => {
    const { t, player, putProfiles } = await setup();
    await withDaily(t);
    const alice = await player("alice");
    await alice.mutation(api.daily.open, {});
    vi.setSystemTime(NOW + 60_000);
    await alice.mutation(api.daily.open, {}); // a reload doesn't restart the clock
    await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
    vi.setSystemTime(NOW + 100_000);
    await alice.mutation(api.daily.guess, { layer: 5, n: 5 }); // both wait on the GPU
    vi.setSystemTime(NOW + 500_000);
    await putProfiles([profile(5, 5, axis(0)), profile(1, 1, axis(1))]);
    expect((await alice.query(api.daily.current, {}))!.result).toMatchObject({ solved: true, seconds: 100 });
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

// Each prize rule, on a bounty ranked from every entry (opened before the standings table) and from its standings
// rows (rankOld builds them the same way finishJudge does).
describe.each([false, true])("bounty settlement (standings table: %s)", (ranked) => {
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
    if (ranked) await t.mutation(internal.bounties.rankOld, {});
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

  test("beating par adds the bonus to a top-three finish, and pays nothing below it", async () => {
    const { t, points } = await bountyWith(
      [{ who: "ann", score: 900 }, { who: "ben", score: 800 }, { who: "cat", score: 700 }, { who: "dan", score: 600 }],
      500,
    );
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ ann: PRIZES[0] + PAR_BONUS, ben: PRIZES[1] + PAR_BONUS, cat: PRIZES[2] + PAR_BONUS, dan: 0 });
  });

  test("a NaN score can't win a prize", async () => {
    const { t, points } = await bountyWith([{ who: "nan", score: NaN }, { who: "oki", score: 10 }]);
    await t.mutation(internal.bounties.settle, {});
    expect(await points()).toEqual({ nan: 0, oki: PRIZES[0] });
  });

  test("a bounty settles the moment it ends, but not while an entry made before then is still being judged", async () => {
    const { t, player } = await setup();
    await t.mutation(internal.bounties.ensure, {});
    const b = (await t.run((ctx) => ctx.db.query("bounties").first()))!;
    const ann = await player("ann");
    vi.setSystemTime(b.endsAt - 1000);
    await ann.mutation(api.bounties.submit, { slug: b.slug, pushes: [{ layer: 1, n: 1, dose: 0.5 }] });
    vi.setSystemTime(b.endsAt);
    await t.finishAllScheduledFunctions(vi.runAllTimers); // the settle ensure scheduled for endsAt
    expect((await t.run((ctx) => ctx.db.get(b._id)))!.settled).toBe(false);
    const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.kind === "judge")!;
    await t.mutation(api.worker.finishJudge, {
      secret: SECRET, id: job._id, entryId: job.args.entryId, score: 700, concept: 0.8, coherence: 0.9, texts: ["r"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(b._id)))!.settled).toBe(true);
    expect((await ann.query(api.players.me, {}))!.points).toBe(PRIZES[0]);
  });

  test("each judged entry replaces its player's standing only if it scores higher", async () => {
    const { t, player } = await setup();
    await t.mutation(internal.bounties.ensure, {});
    const b = (await t.run((ctx) => ctx.db.query("bounties").first()))!;
    const judge = async (who: Awaited<ReturnType<typeof player>>, n: number, score: number) => {
      await who.mutation(api.bounties.submit, { slug: b.slug, pushes: [{ layer: 1, n, dose: 0.5 }] });
      const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.kind === "judge" && j.status === "pending")!;
      await t.mutation(api.worker.finishJudge, { secret: SECRET, id: job._id, entryId: job.args.entryId, score, concept: 0, coherence: 0, texts: [] });
    };
    const [ann, ben] = [await player("ann"), await player("ben")];
    await judge(ann, 1, 300);
    await judge(ben, 2, 800);
    await judge(ann, 3, 900);
    await judge(ann, 4, 900); // ties her best: the earlier one stays
    await judge(ann, 5, 100);
    const { leaderboard } = (await ann.query(api.bounties.get, { slug: b.slug }))!;
    expect(leaderboard.map((r) => [r.handle, r.score, r.you])).toEqual([["ann", 900, true], ["ben", 800, false]]);
    const row = await t.run((ctx) => ctx.db.query("standings").collect());
    const best = (await t.run((ctx) => ctx.db.get(row.find((r) => r.handle === "ann")!.entryId)))!;
    expect(best.pushes[0].n).toBe(3);
  });

  test("a tie at the leaderboard's cutoff keeps the earlier entry, and a second callback can't change a judged entry", async () => {
    const { t, player } = await setup();
    await t.mutation(internal.bounties.ensure, {});
    const b = (await t.run((ctx) => ctx.db.query("bounties").first()))!;
    const ids: Record<string, Id<"players">> = {};
    for (let i = 0; i < 51; i++) {
      const who = `p${String(i).padStart(2, "0")}`;
      await player(who);
      ids[who] = (await t.run((ctx) => ctx.db.query("players").withIndex("by_handle", (q) => q.eq("handleLower", who)).unique()))!._id;
    }
    // 49 clear leaders, then p49 and p50 tie for 50th. p49's entry is earlier but its standing row is older: ordered
    // by row, the tie would go to p50
    await t.run(async (ctx) => {
      const row = (who: string, score: number, at: number) =>
        ctx.db.insert("entries", { bountyId: b._id, playerId: ids[who], pushes: [], status: "pending" }).then((entryId) =>
          ctx.db.insert("standings", { bountyId: b._id, playerId: ids[who], entryId, handle: who, score, neurons: 1, at, negAt: -at }));
      await row("p49", 10, 1);
      for (let i = 0; i < 49; i++) await row(`p${String(i).padStart(2, "0")}`, 100 + i, 0);
      await row("p50", 10, 2);
    });
    const { leaderboard } = (await t.query(api.bounties.get, { slug: b.slug }))!;
    expect(leaderboard).toHaveLength(50);
    expect(leaderboard[49].handle).toBe("p49");

    const ann = await player("ann");
    await ann.mutation(api.bounties.submit, { slug: b.slug, pushes: [{ layer: 1, n: 1, dose: 0.5 }] });
    const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.kind === "judge")!;
    const judged = { secret: SECRET, id: job._id, entryId: job.args.entryId, concept: 0, coherence: 0, texts: [] };
    await t.mutation(api.worker.finishJudge, { ...judged, score: 500 });
    await t.mutation(api.worker.finishJudge, { ...judged, score: 5 });
    await t.mutation(api.worker.fail, { secret: SECRET, id: job._id, error: "late" });
    const entry = (await t.run((ctx) => ctx.db.get(job.args.entryId as Id<"entries">)))!;
    expect([entry.status, entry.score]).toEqual(["done", 500]);
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
