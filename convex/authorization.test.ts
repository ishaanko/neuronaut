/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { dailyPoints } from "./daily";
import { NEW_GUESTS_PER_MINUTE } from "./rules";
import schema from "./schema";

// One player must never see or act on another's private state: unscanned profiles, daily guesses and answers, bounty
// entries, catches. And only the worker, holding WORKER_SECRET, can write results.
const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-worker-secret";
const DATE = "2026-10-27";
const NOW = Date.parse(`${DATE}T12:00:00Z`);
const axis = (i: number) => Array.from({ length: 256 }, (_, j) => Number(i === j));
const pushes = [{ layer: 1, n: 1, dose: 0.6 }];
const ladder = { ranks: [1, 2], cos: [0.5, 0] };
const profile = (n: number, embedding = axis(n)) => ({
  layer: 1, n, texts: [`private reply ${n}`], words: [`word${n}`], z: 5, nll: 2, distinct: 0.9, embedding,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WORKER_SECRET", SECRET);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in offline tests"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ tokenIdentifier: "test|alice" });
  const bob = t.withIdentity({ tokenIdentifier: "test|bob" });
  await alice.mutation(api.players.join, { handle: "Alice" });
  await bob.mutation(api.players.join, { handle: "Bob" });
  const aliceId = (await alice.query(api.players.me, {}))!._id;
  const bobId = (await bob.query(api.players.me, {}))!._id;
  const seedProfile = (n: number) => t.run((ctx) => ctx.db.insert("profiles", { ...profile(n), key: `1:${n}`, caught: false, rarity: "rare" }));
  // The answer is L1 N99, along axis 0: a guess whose profile embeds along axis 0 solves it.
  const seedDaily = () =>
    t.run((ctx) =>
      ctx.db.insert("dailies", {
        date: DATE, key: "1:99", layer: 1, n: 99, prompts: ["prompt"], texts: ["clue"], baseline: ["baseline"],
        embedding: axis(0), ladder, band: [0, 7], hint: "private hint",
      }),
    );
  const seedBounty = () =>
    t.run((ctx) =>
      ctx.db.insert("bounties", {
        slug: "isolation", title: "Isolation", brief: "brief", maxNeurons: 2, prompts: ["private judge prompt"],
        anchors: ["private judge anchor"], startsAt: NOW - 1000, endsAt: NOW + 1000, settled: false,
        par: { score: 1, pushes: [{ layer: 3, n: 3, dose: 0.5 }] },
      }),
    );
  const snapshot = () =>
    t.run(async (ctx) => {
      const tables = ["players", "scans", "guesses", "results", "entries", "jobs", "catches", "profiles", "stats", "bounties", "dailies", "experiments", "places"] as const;
      return Object.fromEntries(await Promise.all(tables.map(async (name) => [name, await ctx.db.query(name).collect()])));
    });
  return { t, alice, bob, aliceId, bobId, seedProfile, seedDaily, seedBounty, snapshot };
}

test("a measured profile shows only to the player who scanned it", async () => {
  const { t, alice, bob, seedProfile } = await setup();
  await seedProfile(1);
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1 });
  expect((await alice.query(api.neurons.card, { layer: 1, n: 1 })).profile?.texts).toEqual(["private reply 1"]);
  for (const viewer of [bob, t])
    expect(await viewer.query(api.neurons.card, { layer: 1, n: 1 })).toMatchObject({ scanned: false, status: "hidden", profile: null });
  expect((await alice.query(api.neurons.seen, {})).map((s) => s.n)).toEqual([1]);
  expect(await bob.query(api.neurons.seen, {})).toEqual([]);
});

test("one player's daily solve doesn't reveal the answer, hints or guesses to anyone else", async () => {
  const { t, alice, bob, seedDaily } = await setup();
  await seedDaily();
  await t.mutation(api.worker.putProfiles, { secret: SECRET, jobIds: [], profiles: [profile(1, axis(0)), profile(2)] });
  await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
  await bob.mutation(api.daily.guess, { layer: 1, n: 2 });
  const a = (await alice.query(api.daily.current, {}))!;
  expect([a.result?.solved, a.answer?.layer, a.answer?.n]).toEqual([true, 1, 99]);
  expect(a.band).toEqual([0, 7]);
  expect(a.hint).toBe("private hint");
  for (const viewer of [bob, t]) {
    expect(await viewer.query(api.daily.current, {})).toMatchObject({ result: null, answer: null, band: null, hint: null });
    expect(await viewer.query(api.daily.tally, { date: DATE })).toEqual({ players: 1, solvers: 1 });
  }
  expect((await bob.query(api.daily.current, {}))!.guesses.map((g) => g.n)).toEqual([2]);
  expect((await t.query(api.daily.current, {}))!.guesses).toEqual([]);
});

test("a guest's game stays theirs: hidden from the leaderboard, never shown to an account, carried over on sign-up", async () => {
  const { t, alice, seedDaily } = await setup();
  await seedDaily();
  await t.mutation(api.worker.putProfiles, { secret: SECRET, jobIds: [], profiles: [profile(1, axis(0))] });
  const guest = "guest-token-0123456789";
  await t.mutation(api.daily.guess, { layer: 1, n: 1, guest });
  expect((await t.query(api.daily.current, { guest }))!.answer).toMatchObject({ layer: 1, n: 99 });
  expect((await t.query(api.players.leaderboard, {})).map((p) => p.handle).sort()).toEqual(["Alice", "Bob"]);
  // a signed-in caller holding the token still gets their own game
  expect(await alice.query(api.daily.current, { guest })).toMatchObject({ result: null, answer: null });
  const carol = t.withIdentity({ tokenIdentifier: "test|carol" });
  await carol.mutation(api.players.join, { handle: "Carol", guest });
  expect((await carol.query(api.daily.current, {}))!.result?.solved).toBe(true);
  expect((await carol.query(api.players.me, {}))!.points).toBe(dailyPoints(1));
  // the token no longer reaches the game it used to name
  expect(await t.query(api.daily.current, { guest })).toMatchObject({ result: null, guesses: [] });
});

test("a script minting guest tokens is cut off each minute, while existing guests and accounts keep playing", async () => {
  const { t, alice, seedDaily } = await setup();
  await seedDaily();
  const token = (i: number) => `minted-guest-token-${String(i).padStart(4, "0")}`;
  for (let i = 0; i < NEW_GUESTS_PER_MINUTE; i++) await t.mutation(api.daily.open, { guest: token(i) });
  await expect(t.mutation(api.daily.guess, { layer: 1, n: 2, guest: token(NEW_GUESTS_PER_MINUTE) })).rejects.toThrow("Lots of new players");
  await t.mutation(api.daily.guess, { layer: 1, n: 2, guest: token(0) }); // already a guest
  await alice.mutation(api.daily.guess, { layer: 1, n: 2 });
  vi.setSystemTime(NOW + 60_000);
  await t.mutation(api.daily.guess, { layer: 1, n: 2, guest: token(NEW_GUESTS_PER_MINUTE) });
});

test("a measured guess settles its own player's daily, whoever's context the worker's callback arrives in", async () => {
  const { t, alice, bob, aliceId, seedDaily } = await setup();
  await seedDaily();
  await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
  await bob.mutation(api.daily.guess, { layer: 1, n: 2 });
  const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.key === "profile:1:1")!;
  expect(job.by).toBe(aliceId);
  await bob.mutation(api.worker.putProfiles, { secret: SECRET, jobIds: [job._id], profiles: [profile(1, axis(0))] });
  expect((await alice.query(api.daily.current, {}))!.result?.solved).toBe(true);
  expect((await alice.query(api.players.me, {}))!.points).toBe(dailyPoints(1));
  expect((await bob.query(api.daily.current, {}))!).toMatchObject({ result: null, guesses: [{ n: 2, status: "pending" }] });
  expect((await bob.query(api.players.me, {}))!.points).toBe(0);
});

test("bounty entries and judged replies stay private until the bounty closes; the judge's prompts never show", async () => {
  const { t, alice, bob, seedBounty } = await setup();
  await seedBounty();
  await alice.mutation(api.bounties.submit, { slug: "isolation", pushes });
  const job = (await t.run((ctx) => ctx.db.query("jobs").collect()))[0];
  await t.mutation(api.worker.finishJudge, {
    secret: SECRET, id: job._id, entryId: job.args.entryId, score: 700, concept: 0.8, coherence: 0.9, texts: ["alice judged reply"],
  });
  expect((await alice.query(api.bounties.get, { slug: "isolation" }))!.mine[0]).toMatchObject({ pushes, texts: ["alice judged reply"] });
  for (const viewer of [bob, t]) {
    const view = (await viewer.query(api.bounties.get, { slug: "isolation" }))!;
    expect(view).toMatchObject({ mine: [], parPushes: null });
    expect(view.leaderboard[0]).toMatchObject({ handle: "Alice", score: 700, pushes: null, texts: null });
    expect(JSON.stringify(view)).not.toMatch(/alice judged reply|private judge/);
  }
  vi.setSystemTime(NOW + 2000);
  expect((await t.query(api.bounties.get, { slug: "isolation" }))!.leaderboard[0].pushes).toBeNull(); // ended, not settled yet
  await t.mutation(internal.bounties.settle, {}); // what the run scheduled for its end does
  const closed = (await t.query(api.bounties.get, { slug: "isolation" }))!;
  expect(closed.leaderboard[0]).toMatchObject({ pushes, texts: ["alice judged reply"] });
  expect(JSON.stringify(closed)).not.toContain("private judge");
});

test("catching needs your own scan, and a catch can't be taken over", async () => {
  const { t, alice, bob, bobId, seedProfile, snapshot } = await setup();
  await seedProfile(1);
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1 });
  await expect(bob.action(api.neurons.catchNeuron, { layer: 1, n: 1, name: "Stolen" })).rejects.toThrow("Scan it before you catch it");
  await expect(t.mutation(internal.neurons.catchCommit, { layer: 1, n: 1, name: "No auth", uniqueness: 1 })).rejects.toThrow("Sign in first");
  await bob.mutation(api.neurons.scan, { layer: 1, n: 1 });
  await bob.action(api.neurons.catchNeuron, { layer: 1, n: 1, name: "Bob's" });
  expect((await t.run((ctx) => ctx.db.query("catches").collect())).map((c) => c.playerId)).toEqual([bobId]);
  const before = await snapshot();
  await expect(alice.action(api.neurons.catchNeuron, { layer: 1, n: 1, name: "Mine now" })).rejects.toThrow("already caught");
  expect(await snapshot()).toEqual(before);
});

test("public pages never carry a player's sign-in identity or a profile's embedding", async () => {
  const { t, alice, seedProfile } = await setup();
  await seedProfile(1);
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1 });
  await alice.action(api.neurons.catchNeuron, { layer: 1, n: 1, name: "Public catch" });
  const pages = {
    card: await t.query(api.neurons.card, { layer: 1, n: 1 }),
    dex: await t.query(api.neurons.dex, { paginationOpts: { numItems: 10, cursor: null } }),
    overview: await t.query(api.neurons.overview, {}),
    leaderboard: await t.query(api.players.leaderboard, {}),
    profile: await t.query(api.players.profile, { handle: "alice" }),
  };
  expect(pages.card.profile?.texts).toEqual(["private reply 1"]); // catching publishes the profile, on purpose
  const json = JSON.stringify(pages);
  for (const leak of ["test|alice", "userId", "embedding", "playerId"]) expect(json).not.toContain(leak);
});

test("every worker endpoint refuses a wrong secret, and all of them refuse when no secret is configured", async () => {
  const { t, bob, bobId, seedBounty, seedDaily, snapshot } = await setup();
  const bountyId = await seedBounty();
  const dailyId = await seedDaily();
  const { entryId, jobId } = await t.run(async (ctx) => {
    const entryId = await ctx.db.insert("entries", { playerId: bobId, bountyId, pushes, status: "pending" });
    const jobId = await ctx.db.insert("jobs", { kind: "judge", key: "job", args: { entryId }, priority: 0, status: "pending", by: bobId });
    return { entryId, jobId };
  });
  // Valid arguments apart from the secret, so the guard (not the validator) is what refuses.
  const experimentId = await t.run((ctx) => ctx.db.insert("experiments", { playerId: bobId, a: pushes[0], b: { ...pushes[0], n: 2 }, date: DATE, status: "pending" }));
  const calls = (secret: string) => [
    () => bob.mutation(api.worker.finishCombo, { secret, id: jobId, experimentId, texts: [], additivity: 1, gain: 1, towardA: 1, towardB: 1 }),
    () => bob.query(api.worker.pending, { secret }),
    () => bob.mutation(api.worker.claim, { secret, max: 1 }),
    () => bob.mutation(api.worker.fail, { secret, id: jobId, error: "x" }),
    () => bob.mutation(api.worker.putProfiles, { secret, jobIds: [jobId], profiles: [profile(1)] }),
    () => bob.mutation(api.worker.putBaseline, { secret, prompts: ["x"], texts: ["x"] }),
    () => bob.mutation(api.worker.finishJudge, { secret, id: jobId, entryId, score: 999, concept: 1, coherence: 1, texts: ["x"] }),
    () => bob.mutation(api.worker.putPar, { secret, id: jobId, slug: "isolation", score: 999, pushes }),
    () => bob.mutation(api.worker.putDaily, {
      secret, id: jobId, date: "2026-10-28", layer: 1, n: 1, prompts: [], texts: [], baseline: [], embedding: axis(0), band: [0, 7], hint: "x", ladder,
    }),
    () => bob.query(api.worker.upcomingDailies, { secret }),
    () => bob.mutation(api.worker.setLadder, { secret, id: dailyId, ladder: { ranks: [1], cos: [1] } }),
    () => bob.mutation(api.worker.putSwept, { secret, swept: 999 }),
  ];
  const before = await snapshot();
  for (const call of calls("wrong")) await expect(call()).rejects.toThrow("bad worker secret");
  for (const call of calls("")) await expect(call()).rejects.toThrow("bad worker secret");
  // Deliberately bypass static typing to exercise the production required-field validators.
  for (const call of calls(undefined as unknown as string)) await expect(call()).rejects.toThrow(/secret/);
  vi.stubEnv("WORKER_SECRET", "");
  for (const call of calls("")) await expect(call()).rejects.toThrow("bad worker secret");
  expect(await snapshot()).toEqual(before);
});

test("forged ownership fields cannot redirect public reads or writes", async () => {
  const { bob, aliceId, snapshot } = await setup();
  const before = await snapshot();
  for (const forged of [{ playerId: aliceId }, { userId: "test|alice" }, { handle: "Alice" }, { isAuthenticated: true }]) {
    // These are runtime attacks: valid client TypeScript would reject the extra fields.
    await expect(bob.query(api.players.me, forged as never)).rejects.toThrow(/Unexpected field/);
    await expect(bob.query(api.lab.mine, forged as never)).rejects.toThrow(/Unexpected field/);
    await expect(bob.query(api.map.mine, forged as never)).rejects.toThrow(/Unexpected field/);
    await expect(bob.query(api.daily.current, forged as never)).rejects.toThrow(/Unexpected field/);
    await expect(bob.mutation(api.daily.guess, { layer: 1, n: 1, ...forged })).rejects.toThrow(/Unexpected field/);
    await expect(bob.mutation(api.bounties.submit, { slug: "isolation", pushes, ...forged })).rejects.toThrow(/Unexpected field/);
    await expect(bob.mutation(api.neurons.scan, { layer: 1, n: 1, ...forged })).rejects.toThrow(/Unexpected field/);
  }
  expect(await snapshot()).toEqual(before);
});

test("catch action and both internal authorization paths reject absent or uninitialized identities", async () => {
  const { t, snapshot } = await setup();
  const before = await snapshot();
  for (const [viewer, message] of [[t, "Sign in first"], [t.withIdentity({ tokenIdentifier: "test|new" }), "Pick a handle first"]] as const) {
    await expect(viewer.action(api.neurons.catchNeuron, { layer: 1, n: 1, name: "Catch" })).rejects.toThrow(message);
    await expect(viewer.query(internal.neurons.catchCheck, { layer: 1, n: 1 })).rejects.toThrow(message);
    await expect(viewer.mutation(internal.neurons.catchCommit, { layer: 1, n: 1, name: "Catch", uniqueness: 1 })).rejects.toThrow(message);
    await expect(viewer.mutation(api.lab.run, { a: pushes[0], b: { ...pushes[0], n: 2 } })).rejects.toThrow(message);
  }
  expect(await snapshot()).toEqual(before);
});

test.each(["complete", "fail"] as const)("a shared profile job can %s after logout without mixing its players' progress", async (outcome) => {
  const { t, alice, bob, aliceId, bobId, seedDaily } = await setup();
  await seedDaily();
  await alice.mutation(api.daily.guess, { layer: 1, n: 1 });
  await bob.mutation(api.daily.guess, { layer: 1, n: 1 });
  const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
  expect(jobs).toHaveLength(1);
  expect(jobs[0].by).toBe(aliceId);
  if (outcome === "complete") {
    const callback = { secret: SECRET, jobIds: [jobs[0]._id], profiles: [profile(1, axis(0))] };
    await t.mutation(api.worker.putProfiles, callback); // no player session is needed by the worker
    await t.mutation(api.worker.putProfiles, callback); // retry must not award twice
  } else {
    await t.mutation(api.worker.fail, { secret: SECRET, id: jobs[0]._id, error: "synthetic failure" });
  }
  const returningAlice = t.withIdentity({ tokenIdentifier: "test|alice", sessionId: "new-session" });
  expect((await returningAlice.query(api.players.me, {}))!._id).toBe(aliceId);
  expect((await bob.query(api.players.me, {}))!._id).toBe(bobId);
  for (const viewer of [returningAlice, bob]) {
    const daily = (await viewer.query(api.daily.current, {}))!;
    expect(daily.guesses).toHaveLength(outcome === "complete" ? 1 : 0);
    expect(daily.result?.solved ?? false).toBe(outcome === "complete");
    expect((await viewer.query(api.players.me, {}))!.points).toBe(outcome === "complete" ? dailyPoints(1) : 0);
  }
  expect((await t.query(api.daily.current, {}))!.result).toBeNull();
});

test("replaying a scan preserves its ID, quota and prediction award across sessions", async () => {
  const { t, alice, aliceId, bob, snapshot } = await setup();
  await alice.mutation(api.neurons.scan, { layer: 1, n: 1, prediction: "quiet" });
  const before = await snapshot();
  const returning = t.withIdentity({ tokenIdentifier: "test|alice", sessionId: "renewed" });
  await returning.mutation(api.neurons.scan, { layer: 1, n: 1, prediction: "word" });
  expect(await snapshot()).toEqual(before);
  expect((await returning.query(api.players.me, {}))!._id).toBe(aliceId);
  expect(await bob.query(api.neurons.seen, {})).toEqual([]);
  expect(await t.query(api.neurons.seen, {})).toEqual([]);
});

test("a lab callback writes only the admitted owner's private experiment after an account switch", async () => {
  const { t, alice, bob, aliceId } = await setup();
  const id = await alice.mutation(api.lab.run, { a: pushes[0], b: { ...pushes[0], n: 2 } });
  const job = (await t.run((ctx) => ctx.db.query("jobs").collect()))[0];
  expect(job.by).toBe(aliceId);
  await bob.mutation(api.worker.finishCombo, {
    secret: SECRET, id: job._id, experimentId: id, texts: ["private lab output"], additivity: 0.9, gain: 1, towardA: 0.7, towardB: 0.8,
  });
  expect(await bob.query(api.lab.mine, {})).toEqual([]);
  expect(await t.query(api.lab.mine, {})).toEqual([]);
  expect(await alice.query(api.lab.mine, {})).toMatchObject([{ id, status: "done", texts: ["private lab output"] }]);
});


test("mutable identity claims do not change ownership and another issuer cannot claim the same subject", async () => {
  const { t } = await setup();
  const identity = { subject: "same-subject", issuer: "https://issuer-one.example", tokenIdentifier: "issuer-one|same-subject" };
  const owner = t.withIdentity(identity);
  await owner.mutation(api.players.join, { handle: "Stable" });
  const me = await owner.query(api.players.me, {});
  const renewed = t.withIdentity({ ...identity, name: "Changed", nickname: "Bob", sessionId: "renewed" });
  expect(await renewed.query(api.players.me, {})).toEqual(me);
  const other = t.withIdentity({ subject: identity.subject, issuer: "https://issuer-two.example", tokenIdentifier: "issuer-two|same-subject" });
  expect(await other.query(api.players.me, {})).toBeNull();
  // Synthetic identities test database lookup isolation, not which JWT issuers a deployment accepts.
});
