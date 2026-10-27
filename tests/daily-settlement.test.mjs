import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Node 24+, no installed dependencies or Convex client. Load the real submission,
// resolution, settlement, date, and enqueue code. Only registration/validators
// are stubbed. Python/worker modules and all other production imports are denied.
const root = new URL("../convex/", import.meta.url);
const sources = new Set(["daily.ts", "jobs.ts", "lib.ts", "rules.ts"]);
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs = {
  "convex/values": moduleUrl(`
    export class ConvexError extends Error { constructor(data) { super(data); this.data = data; } }
    export const v = Object.fromEntries(["string", "number", "optional"].map(name => [name, () => ({})]));
  `),
  "./_generated/server": moduleUrl(`
    export const query = definition => definition;
    export const mutation = query;
    export const internalMutation = query;
  `),
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href)) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      const name = `${specifier.replace(/^\.\//, "")}.ts`;
      if (!sources.has(name)) throw new Error(`Unexpected production import: ${specifier}`);
      return { url: new URL(name, root).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let daily;
try {
  daily = await import(new URL("daily.ts", root).href);
} finally {
  hooks.deregister();
}

const TOKEN = "offline-settlement-player";
const PLAYER = "players:1";
const DATES = ["2026-10-27", "2026-10-28", "2026-10-29"];
const indexes = {
  dailies: { by_date: ["date"] }, players: { by_token: ["tokenHash"] },
  guesses: { by_player_date: ["playerId", "date"], by_key_status: ["key", "status"] },
  results: { by_player_date: ["playerId", "date"], by_date: ["date"] },
  scans: { by_player_key: ["playerId", "key"], by_player_date: ["playerId", "date"] },
  profiles: { by_key: ["key"] }, jobs: { by_key: ["key"] },
};

function game(t, playerFields = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(`${DATES[0]}T12:00:00Z`) });
  const tables = {
    players: [{
      _id: PLAYER, tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
      points: 100, dailySolved: 0, streak: 0, bestStreak: 0, ...playerFields,
    }],
    dailies: DATES.map(date => ({
      _id: `daily:${date}`, date, key: "0:9000", layer: 0, n: 9000,
      prompts: ["offline"], texts: ["steered"], baseline: ["baseline"],
      embedding: [1, 0], neighbors: [0.9, 0.5], band: [0, 7], hint: "hint",
    })),
    guesses: [], results: [], scans: [], profiles: [], jobs: [],
  };
  const writes = [];
  let sequence = 0;
  const db = {
    query(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      let fields = [];
      const predicates = [];
      const rows = () => tables[table].filter(row => predicates.every(predicate => predicate(row)))
        .toSorted((a, b) => {
          for (const field of [...fields, "_creationTime"]) {
            if (a[field] < b[field]) return -1;
            if (a[field] > b[field]) return 1;
          }
          return 0;
        }).map(row => structuredClone(row));
      const query = {
        withIndex(name, select) {
          fields = indexes[table][name];
          assert.ok(fields, `Unexpected index: ${table}.${name}`);
          const index = { eq(field, value) { predicates.push(row => row[field] === value); return index; } };
          select(index);
          return query;
        },
        filter(select) {
          predicates.push(select({
            field: name => row => row[name], eq: (field, value) => row => field(row) === value,
            or: (...choices) => row => choices.some(choice => choice(row)),
          }));
          return query;
        },
        async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
        async first() { return rows()[0] ?? null; },
        async collect() { return rows(); },
      };
      return query;
    },
    async get(id) {
      return structuredClone(Object.values(tables).flat().find(row => row._id === id) ?? null);
    },
    async insert(table, value) {
      const id = `${table}:${++sequence}`;
      tables[table].push({ _id: id, _creationTime: Date.now() + sequence / 1000, ...structuredClone(value) });
      writes.push({ op: "insert", table, id });
      return id;
    },
    async patch(id, value) {
      const table = Object.keys(tables).find(name => tables[name].some(row => row._id === id));
      assert.ok(table, `Missing document: ${id}`);
      Object.assign(tables[table].find(row => row._id === id), structuredClone(value));
      writes.push({ op: "patch", table, id });
    },
  };
  const ctx = { db };
  // Model atomic rollback for an aborted invocation; this does not simulate OCC.
  async function transaction(fn) {
    const snapshot = structuredClone(tables), count = writes.length, seq = sequence;
    try { return await fn(ctx); }
    catch (error) {
      Object.assign(tables, snapshot);
      writes.length = count;
      sequence = seq;
      throw error;
    }
  }
  return {
    tables, writes, transaction,
    player: () => structuredClone(tables.players[0]),
    at: instant => t.mock.timers.setTime(Date.parse(instant)),
    submit: n => transaction(ctx => daily.guess.handler(ctx, { token: TOKEN, layer: 0, n })),
    complete: (n, correct) => transaction(ctx => daily.resolvePending(ctx, `0:${n}`, correct ? [1, 0] : [0, 1])),
    view: (date, ...tokens) => daily.current.handler(ctx, { date, token: tokens.length ? tokens[0] : TOKEN }),
    result: date => tables.results.find(row => row.date === date),
  };
}

function permutations(values) {
  return values.length === 0 ? [[]] : values.flatMap((value, i) =>
    permutations(values.filter((_, j) => j !== i)).map(rest => [value, ...rest]));
}

// Exhaust all 8 outcome patterns and all 6 completion orders for three attempts.
for (const outcomes of [
  [false, false, false], [false, false, true], [false, true, false], [false, true, true],
  [true, false, false], [true, false, true], [true, true, false], [true, true, true],
]) {
  for (const order of permutations([0, 1, 2])) {
    test(`outcomes ${outcomes.map(Number)} completed ${order} keep submission-order scoring`, async t => {
      const f = game(t);
      for (const n of [1, 2, 3]) await f.submit(n);
      for (const i of order) await f.complete(i + 1, outcomes[i]);
      const winning = outcomes.indexOf(true);
      assert.equal(f.tables.jobs.length, 3);
      assert.equal(f.tables.guesses.length, 3);
      if (winning < 0) {
        assert.equal(f.result(DATES[0]), undefined);
        assert.equal(f.player().points, 100);
        assert.equal(f.player().dailySolved, 0);
      } else {
        const attempts = winning + 1;
        assert.deepEqual(f.result(DATES[0]).heats, Array.from({ length: attempts }, (_, i) => outcomes[i] ? 100 : 0));
        assert.equal(f.result(DATES[0]).guesses, attempts);
        assert.equal(f.result(DATES[0]).solved, true);
        assert.equal(f.player().points, [138, 136, 134][winning]);
        assert.equal(f.player().dailySolved, 1);
      }
      assert.equal(f.tables.results.length, winning < 0 ? 0 : 1);
    });
  }
}

test("later hit stays provisional and redacted until the earlier guess finishes", async t => {
  const f = game(t);
  await f.submit(1); await f.submit(2);
  await f.complete(2, true);
  assert.equal(f.result(DATES[0]), undefined);
  assert.equal(f.player().points, 100);
  const view = await f.view(DATES[0]);
  assert.equal(view.result, null); assert.equal(view.answer, null);
  assert.equal(view.guesses.find(g => g.n === 1).status, "pending");
  assert.equal(view.guesses.find(g => g.n === 2).correct, true);
  const writes = [...f.writes];
  await assert.rejects(f.submit(3), /Waiting for earlier guesses to finish/);
  assert.deepEqual(f.writes, writes);
  assert.equal(f.tables.jobs.length, 2);
  await f.complete(1, false);
  assert.equal(f.result(DATES[0]).guesses, 2);
  assert.deepEqual(f.result(DATES[0]).heats, [0, 100]);
  assert.deepEqual((await f.view(DATES[0])).answer, { layer: 0, n: 9000 });
  assert.equal((await f.view(DATES[0], undefined)).answer, null);
});

test("later pending guesses do not delay a final first-attempt win or change it later", async t => {
  const f = game(t);
  await f.submit(1); await f.submit(2);
  await f.complete(1, true);
  const result = structuredClone(f.result(DATES[0]));
  assert.equal(result.guesses, 1);
  assert.equal(f.tables.guesses.find(g => g.n === 2).status, "pending");
  await f.complete(2, true);
  assert.deepEqual(f.result(DATES[0]), result);
  assert.equal(f.player().points, 138);
});

for (const order of [Array.from({ length: 15 }, (_, i) => i), Array.from({ length: 15 }, (_, i) => 14 - i), [14, 0, 13, 1, 12, 2, 11, 3, 10, 4, 9, 5, 8, 6, 7]]) {
  test(`15 wrong guesses completed ${order} settle only after the final resolution`, async t => {
    const f = game(t);
    for (let i = 1; i <= 15; i++) await f.submit(i);
    const writes = [...f.writes];
    await assert.rejects(f.submit(16), /Out of guesses/);
    assert.deepEqual(f.writes, writes);
    for (const i of order.slice(0, -1)) await f.complete(i + 1, false);
    assert.equal(f.result(DATES[0]), undefined);
    assert.equal((await f.view(DATES[0])).answer, null);
    await f.complete(order.at(-1) + 1, false);
    assert.equal(f.result(DATES[0]).solved, false);
    assert.equal(f.result(DATES[0]).guesses, 15);
    assert.deepEqual(f.result(DATES[0]).heats, Array(15).fill(0));
    assert.equal(f.player().points, 100);
    assert.deepEqual((await f.view(DATES[0])).answer, { layer: 0, n: 9000 });
    assert.equal(f.tables.jobs.length, 15);
  });
}

test("duplicate callbacks and an aborted/retried transaction cannot double-award", async t => {
  const f = game(t);
  await f.submit(1);
  await assert.rejects(f.transaction(async ctx => {
    await daily.resolvePending(ctx, "0:1", [1, 0]);
    throw new Error("simulated transaction abort");
  }), /simulated transaction abort/);
  assert.equal(f.player().points, 100);
  assert.equal(f.tables.results.length, 0);
  await f.complete(1, true);
  const snapshot = structuredClone(f.tables), writes = [...f.writes];
  await f.complete(1, true); await f.complete(1, false);
  assert.deepEqual(f.tables, snapshot);
  assert.deepEqual(f.writes, writes);
  assert.equal(f.player().points, 138);
  assert.equal(f.player().dailySolved, 1);
});

test("an existing settled result and its awarded points remain immutable", async t => {
  const f = game(t, { points: 136, dailySolved: 1, streak: 1, bestStreak: 1, lastSolved: DATES[0] });
  await f.submit(1); await f.submit(2);
  f.tables.results.push({ _id: "legacy:result", _creationTime: 1, playerId: PLAYER, date: DATES[0], solved: true, guesses: 2, heats: [0, 100] });
  const player = f.player(), result = structuredClone(f.result(DATES[0]));
  await f.complete(1, true); await f.complete(2, true);
  assert.deepEqual(f.player(), player);
  assert.deepEqual(f.result(DATES[0]), result);
  const writes = [...f.writes];
  await assert.rejects(f.submit(3), /already finished/);
  assert.deepEqual(f.writes, writes);
});

test("failed or timed-out earlier work remains indeterminate until a real outcome arrives", async t => {
  const f = game(t);
  await f.submit(1); await f.submit(2);
  // The inspected worker failure contract changes the job, not the Daily guess.
  f.tables.jobs.find(j => j.key === "profile:0:1").status = "failed";
  await f.complete(2, true);
  f.at("2026-10-29T12:00:00Z");
  assert.equal(f.result(DATES[0]), undefined);
  assert.equal(f.tables.guesses.find(g => g.n === 1).status, "pending");
  assert.equal((await f.view(DATES[0])).answer, null);
  assert.equal(f.player().points, 100);
  assert.equal(f.tables.jobs.length, 2);
  // A later successful profile (e.g. sweep/retry) supplies the actual outcome.
  await f.complete(1, true);
  assert.equal(f.result(DATES[0]).guesses, 1);
  assert.equal(f.player().points, 138);
});

const histories = [
  { solved: [true, true, true], points: 214, count: 3, streak: 3, best: 3, last: DATES[2] },
  { solved: [true, false, true], points: 176, count: 2, streak: 1, best: 1, last: DATES[2] },
  { solved: [false, true, true], points: 176, count: 2, streak: 2, best: 2, last: DATES[2] },
  { solved: [true, true, false], points: 176, count: 2, streak: 0, best: 2, last: DATES[1] },
  { solved: [false, false, false], points: 100, count: 0, streak: 0, best: 0, last: undefined },
];
for (const history of histories) {
  for (const order of permutations([0, 1, 2])) {
    test(`dated outcomes ${history.solved.map(Number)} settled ${order} preserve streak chronology`, async t => {
      const f = game(t);
      for (let day = 0; day < 3; day++) {
        f.at(`${DATES[day]}T12:00:00Z`);
        for (let i = 0; i < (history.solved[day] ? 1 : 15); i++) await f.submit(100 + day * 100 + i);
      }
      f.at("2026-10-30T12:00:00Z");
      const jobs = f.tables.jobs.length;
      for (const day of order) {
        for (let i = 0; i < (history.solved[day] ? 1 : 15); i++) await f.complete(100 + day * 100 + i, history.solved[day]);
      }
      assert.equal(f.player().points, history.points);
      assert.equal(f.player().dailySolved, history.count);
      assert.equal(f.player().streak, history.streak);
      assert.equal(f.player().bestStreak, history.best);
      assert.equal(f.player().lastSolved, history.last);
      assert.equal(f.tables.results.length, 3);
      assert.equal(f.tables.jobs.length, jobs);
    });
  }
}

test("a skipped date breaks adjacency while a delayed older win cannot rewind lastSolved", async t => {
  const f = game(t, { bestStreak: 9 });
  await f.submit(1);
  f.at(`${DATES[2]}T12:00:00Z`); await f.submit(2);
  await f.complete(2, true); await f.complete(1, true);
  assert.equal(f.player().streak, 1);
  assert.equal(f.player().lastSolved, DATES[2]);
  assert.equal(f.player().bestStreak, 9);
  assert.equal(f.player().points, 176);
});

test("one shared-profile callback may settle several dates without ordering the awards incorrectly", async t => {
  const f = game(t);
  for (const date of DATES) { f.at(`${date}T12:00:00Z`); await f.submit(1); }
  // Deliberately make resolver iteration differ from calendar order.
  f.tables.guesses[0]._creationTime = 3;
  f.tables.guesses[1]._creationTime = 1;
  f.tables.guesses[2]._creationTime = 2;
  await f.complete(1, true);
  assert.equal(f.player().points, 214);
  assert.equal(f.player().dailySolved, 3);
  assert.equal(f.player().streak, 3);
  assert.equal(f.player().lastSolved, DATES[2]);
  assert.equal(f.tables.jobs.length, 1);
});

test("UTC midnight separates submission dates while late results keep their original date", async t => {
  const f = game(t);
  f.at("2026-10-27T23:59:59.999Z"); await f.submit(1);
  f.at("2026-10-28T00:00:00.000Z"); await f.submit(2);
  assert.deepEqual(f.tables.guesses.map(g => g.date), DATES.slice(0, 2));
  await f.complete(2, true); await f.complete(1, true);
  assert.equal(f.player().streak, 2);
  assert.equal(f.player().lastSolved, DATES[1]);
  assert.equal(f.player().points, 176);
});

test("cached and exact-key outcomes keep the existing eligibility and score rules", async t => {
  const f = game(t);
  f.tables.profiles.push({ _id: "profile:cached", key: "0:9000", embedding: [0, 1] });
  await f.submit(9000);
  assert.equal(f.result(DATES[0]).guesses, 1);
  assert.equal(f.player().points, 138);
  assert.equal(f.tables.jobs.length, 0);
});

test("an earlier wrong guess contributes its real heat instead of a pending zero placeholder", async t => {
  const f = game(t);
  await f.submit(1); await f.submit(2);
  await f.complete(2, true);
  await f.transaction(ctx => daily.resolvePending(ctx, "0:1", [0.6, 0.8]));
  assert.deepEqual(f.result(DATES[0]).heats, [60, 100]);
  assert.equal(f.result(DATES[0]).guesses, 2);
  assert.equal(f.player().points, 136);
});

test("similarity eligibility keeps the 0.97 threshold and existing cached path", async t => {
  const f = game(t);
  f.tables.profiles.push(
    { _id: "profile:below", key: "0:1", embedding: [0.9699, 0.2435] },
    { _id: "profile:at", key: "0:2", embedding: [0.97, 0.2431049156] },
  );
  await f.submit(1);
  assert.equal(f.result(DATES[0]), undefined);
  await f.submit(2);
  assert.equal(f.result(DATES[0]).guesses, 2);
  assert.equal(f.player().points, 136);
  assert.equal(f.tables.jobs.length, 0);
});

test("a fifteenth-attempt hit waits for its prefix and retains the ten-point minimum", async t => {
  const f = game(t);
  for (let n = 1; n <= 15; n++) await f.submit(n);
  await f.complete(15, true);
  assert.equal(f.result(DATES[0]), undefined);
  for (let n = 14; n >= 1; n--) await f.complete(n, false);
  assert.equal(f.result(DATES[0]).guesses, 15);
  assert.equal(f.player().points, 110);
  assert.equal(f.tables.jobs.length, 15);
});

test("a failed guess among fifteen attempts does not silently count as a loss", async t => {
  const f = game(t);
  for (let n = 1; n <= 15; n++) await f.submit(n);
  f.tables.jobs.find(j => j.key === "profile:0:1").status = "failed";
  for (let n = 2; n <= 15; n++) await f.complete(n, false);
  f.at("2026-10-30T12:00:00Z");
  assert.equal(f.result(DATES[0]), undefined);
  assert.equal((await f.view(DATES[0])).answer, null);
  assert.equal(f.player().points, 100);
  await f.complete(1, false);
  assert.equal(f.result(DATES[0]).solved, false);
  assert.equal(f.tables.jobs.length, 15);
});

for (const existingAnchor of [false, true]) {
  test(`incomplete legacy history preserves streak aggregates (anchor present: ${existingAnchor})`, async t => {
    const f = game(t, { lastSolved: DATES[2], streak: 5, bestStreak: 7, dailySolved: 20, points: 900 });
    if (existingAnchor) f.tables.results.push({
      _id: "legacy:anchor", _creationTime: 1, playerId: PLAYER, date: DATES[2], solved: true, guesses: 1, heats: [100],
    });
    await f.submit(1);
    await f.complete(1, true);
    assert.equal(f.result(DATES[0]).solved, true);
    assert.equal(f.player().points, 938);
    assert.equal(f.player().dailySolved, 21);
    assert.equal(f.player().lastSolved, DATES[2]);
    assert.equal(f.player().streak, 5);
    assert.equal(f.player().bestStreak, 7);
    // Newer completions also must not fabricate the missing five-day history.
    f.tables.dailies.push({ ...f.tables.dailies[0], _id: "daily:2026-10-30", date: "2026-10-30" });
    f.at("2026-10-30T12:00:00Z"); await f.submit(2); await f.complete(2, true);
    assert.equal(f.player().points, 976);
    assert.equal(f.player().dailySolved, 22);
    assert.equal(f.player().lastSolved, DATES[2]);
    assert.equal(f.player().streak, 5);
  });
}
