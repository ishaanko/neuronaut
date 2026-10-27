import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Node 24+: run the real Daily query, date utilities, and credential lookup.
// Only Convex registration/validators are stubbed. The import allowlist excludes
// worker/model code; the database below is read-only and entirely in memory.
const convexRoot = new URL("../convex/", import.meta.url);
const sources = new Set(["daily.ts", "jobs.ts", "lib.ts", "rules.ts"]);
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs = {
  "convex/values": moduleUrl(`
    export class ConvexError extends Error {
      constructor(data) { super(data); this.data = data; }
    }
    export const v = Object.fromEntries(
      ["string", "number", "optional"].map(name => [name, () => ({})])
    );
  `),
  "./_generated/server": moduleUrl(`
    export const query = definition => definition;
    export const mutation = query;
    export const internalMutation = query;
  `),
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(convexRoot.href)) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      const filename = `${specifier.replace(/^\.\//, "")}.ts`;
      if (!sources.has(filename)) throw new Error(`Unexpected production import: ${specifier}`);
      return { url: new URL(filename, convexRoot).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let current;
try {
  ({ current } = await import(new URL("daily.ts", convexRoot).href));
} finally {
  hooks.deregister();
}

const NOW = "2026-10-27T12:00:00.000Z";
const TOKEN = "offline-player-credential";
const player = { _id: "player:1", tokenHash: createHash("sha256").update(TOKEN).digest("hex") };
const callers = [
  { name: "guest" },
  { name: "invalid credential", token: "unknown-credential" },
  { name: "unfinished player", token: TOKEN },
  { name: "completed winner", token: TOKEN, solved: true },
  { name: "completed non-solver", token: TOKEN, solved: false },
];

function setTime(t, instant = NOW) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
}

function puzzle(date) {
  return {
    _id: `daily:${date}`, _creationTime: 1, date, key: "17:8123", layer: 17, n: 8123,
    prompts: [`private prompt ${date}`], texts: [`private output ${date}`], baseline: [`baseline ${date}`],
    embedding: [0.1, 0.2], neighbors: [0.9, 0.8], band: [14, 21], hint: "private-hint",
  };
}

function fixture({ dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-11-03"], progressDate = "2026-10-27", solved, guesses = 0 } = {}) {
  const tables = {
    dailies: dates.map(puzzle), players: [player],
    guesses: Array.from({ length: guesses }, (_, i) => ({
      _id: `guess:${i}`, _creationTime: i + 1, playerId: player._id, date: progressDate,
      key: `1:${i}`, layer: 1, n: i, status: "done", heat: i * 5, rank: 100 - i, correct: false,
    })),
    results: solved === undefined ? [] : [{
      _id: "result:1", playerId: player._id, date: progressDate, solved, guesses: 3, heats: [5, 10, 100],
    }],
  };
  const reads = [];
  const db = {
    query(table) {
      reads.push(table);
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      let rows = [...tables[table]];
      const query = {
        withIndex(_name, select) {
          const index = { eq(field, value) { rows = rows.filter(row => row[field] === value); return index; } };
          select(index);
          return query;
        },
        async unique() { assert.ok(rows.length <= 1); return rows[0] ?? null; },
        async collect() { return rows; },
      };
      return query;
    },
  };
  return { reads, query: args => current.handler({ db }, args) };
}

for (const date of ["2026-10-26", "2026-10-27"]) {
  for (const caller of callers) {
    test(`${date} remains readable for ${caller.name}`, async t => {
      setTime(t);
      const f = fixture({ progressDate: date, solved: caller.solved });
      const result = await f.query({ date, token: caller.token });
      assert.deepEqual(result.prompts, puzzle(date).prompts);
      assert.deepEqual(result.texts, puzzle(date).texts);
      assert.deepEqual(result.baseline, puzzle(date).baseline);
      assert.equal(result.date, date);
      assert.equal(result.number, date === "2026-10-27" ? 1 : 0);
      assert.equal(result.limit, 15);
      assert.deepEqual(result.hintsAt, { band: 5, token: 10 });
      const finished = caller.solved !== undefined;
      assert.deepEqual(result.answer, finished ? { layer: 17, n: 8123 } : null);
      assert.deepEqual(result.band, finished ? [14, 21] : null);
      assert.equal(result.hint, finished ? "private-hint" : null);
      assert.deepEqual(result.result, finished ? { solved: caller.solved, guesses: 3, heats: [5, 10, 100] } : null);
      assert.equal(result.players, finished ? 1 : 0);
      assert.equal(result.solvers, caller.solved === true ? 1 : 0);
      assert.deepEqual(result.guesses, []);
      assert.deepEqual(Object.keys(result).sort(), [
        "date", "number", "prompts", "texts", "baseline", "limit", "hintsAt", "band", "hint", "guesses", "result", "answer", "players", "solvers",
      ].sort());
    });
  }
}

for (const date of ["2026-10-28", "2026-11-03"]) {
  for (const caller of callers) {
    test(`${date} discloses nothing to ${caller.name}, even with stored completion`, async t => {
      setTime(t);
      const f = fixture({ progressDate: date, solved: caller.solved, guesses: 15 });
      // Exact null excludes clues, answers, hints, progress, and all private metadata.
      assert.equal(await f.query({ date, token: caller.token }), null);
      assert.deepEqual(f.reads, []);
    });
  }
}

for (const date of [
  "not-a-date", "", "2026-1-01", "2026-10-7", "20261027", "2026/10/27",
  "2026-10-27T00:00:00Z", "2026-10-27T23:00:00-12:00", " 2026-10-27", "2026-10-27 ",
  "2026-10-27\n", "2026-02-30", "2026-02-29", "1900-02-29", "2026-00-01", "2026-13-01", "2026-10-00", "2026-10-32",
]) {
  test(`rejects malformed/noncanonical date ${JSON.stringify(date)} without reading stored clues`, async t => {
    setTime(t);
    // A matching poisoned row ensures the test checks validation, not missing data.
    const f = fixture({ dates: [date], progressDate: date, solved: true, guesses: 15 });
    assert.equal(await f.query({ date, token: TOKEN }), null);
    assert.deepEqual(f.reads, []);
  });
}

for (const [before, release, yesterday, date] of [
  ["2026-10-27T23:59:59.999Z", "2026-10-28T00:00:00.000Z", "2026-10-27", "2026-10-28"],
  ["2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00.000Z", "2026-12-31", "2027-01-01"],
  ["2028-02-28T23:59:59.999Z", "2028-02-29T00:00:00.000Z", "2028-02-28", "2028-02-29"],
]) {
  test(`releases ${date} exactly at UTC midnight`, async t => {
    setTime(t, before);
    const f = fixture({ dates: [yesterday, date] });
    assert.equal(await f.query({ date }), null);
    assert.deepEqual(f.reads, []);
    assert.equal((await f.query({})).date, yesterday);
    t.mock.timers.setTime(Date.parse(release));
    assert.equal((await f.query({ date })).date, date);
    assert.equal((await f.query({})).date, date);
    assert.equal((await f.query({ date: yesterday })).date, yesterday);
  });
}

for (const token of [undefined, TOKEN]) {
  test(`omitted date uses the server UTC day (${token ? "player" : "guest"})`, async t => {
    setTime(t, "2026-10-27T00:01:00.000Z");
    const f = fixture();
    assert.equal((await f.query({ token })).date, "2026-10-27");
  });
}

test("missing released and unreleased puzzles return the same safe null", async t => {
  setTime(t);
  for (const date of ["2026-10-26", "2026-10-27", "2026-10-28"]) {
    for (const token of [undefined, TOKEN]) {
      assert.equal(await fixture({ dates: [] }).query({ date, token }), null);
    }
  }
  assert.equal(await fixture({ dates: [] }).query({}), null);
});

for (const [guesses, band, hint] of [[5, [14, 21], null], [10, [14, 21], "private-hint"]]) {
  test(`preserves released-puzzle hints and progress at ${guesses} guesses`, async t => {
    setTime(t);
    const f = fixture({ guesses });
    const result = await f.query({ token: TOKEN });
    assert.deepEqual(result.band, band);
    assert.equal(result.hint, hint);
    assert.equal(result.answer, null);
    assert.equal(result.result, null);
    assert.equal(result.guesses.length, guesses);
    assert.deepEqual(result.guesses[0], {
      layer: 1, n: guesses - 1, status: "done", heat: (guesses - 1) * 5, rank: 101 - guesses, correct: false, at: guesses,
    });
  });
}
