import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Node 24+: load the real submission, ownership, rules, and enqueue code without
// installing packages or connecting to Convex. Only SDK registration/validators
// are stubbed; these tests do not exercise Convex serialization or transactions.
const convexRoot = new URL("../convex/", import.meta.url);
const sources = new Set(["bounties.ts", "bountyPool.ts", "jobs.ts", "lib.ts", "rules.ts"]);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const stubs = {
  "convex/values": moduleUrl(`
    export class ConvexError extends Error {
      constructor(data) { super(data); this.data = data; }
    }
    export const v = Object.fromEntries(
      ["string", "number", "optional", "array"].map(name => [name, () => ({})])
    );
  `),
  "./_generated/server": moduleUrl(`
    export const mutation = definition => definition;
    export const internalMutation = mutation;
    export const query = mutation;
  `),
  "./schema": moduleUrl("export const push = {};"),
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
let submit;
try {
  ({ submit } = await import(new URL("bounties.ts", convexRoot).href));
} finally {
  hooks.deregister();
}

const token = "offline-test-credential";
const player = { _id: "player:1", tokenHash: createHash("sha256").update(token).digest("hex") };
const push = (dose, n = 0) => ({ layer: 0, n, dose });

function fixture({ maxNeurons = 3, entries = 0 } = {}) {
  const bounty = {
    _id: "bounty:1", slug: "offline-bounty", maxNeurons,
    startsAt: 0, endsAt: Number.MAX_SAFE_INTEGER,
    prompts: ["offline prompt"], anchors: ["offline anchor"],
  };
  const tables = {
    players: [player], bounties: [bounty], jobs: [],
    entries: Array.from({ length: entries }, (_, i) => ({
      _id: `entry:existing:${i}`, playerId: player._id, bountyId: bounty._id,
    })),
  };
  const writes = [];
  const db = {
    query(table) {
      let rows = [...tables[table]];
      const query = {
        withIndex(_name, select) {
          const index = { eq(field, value) { rows = rows.filter(row => row[field] === value); return index; } };
          select(index);
          return query;
        },
        filter(select) {
          const expr = {
            field: name => row => row[name],
            eq: (field, value) => row => field(row) === value,
            or: (...predicates) => row => predicates.some(predicate => predicate(row)),
          };
          rows = rows.filter(select(expr));
          return query;
        },
        async unique() { assert.ok(rows.length <= 1); return rows[0] ?? null; },
        async collect() { return rows; },
        async first() { return rows[0] ?? null; },
      };
      return query;
    },
    async insert(table, value) {
      const _id = `${table}:${tables[table].length + 1}`;
      writes.push({ table, value });
      tables[table].push({ _id, ...value });
      return _id;
    },
  };
  return {
    tables, writes,
    submit: pushes => submit.handler({ db }, { token, slug: bounty.slug, pushes }),
  };
}

// The mock deliberately does not roll back writes on rejection: these assertions
// prove validation happens before even attempting entry or judging-job creation.
for (const dose of [NaN, Infinity, -Infinity, 0, -0, 0.049999, -0.049999, 1.000001, -1.000001]) {
  test(`rejects dose ${Object.is(dose, -0) ? "-0" : String(dose)} before any write`, async () => {
    const f = fixture();
    await assert.rejects(f.submit([push(dose)]), { message: "Doses are 0.05 to 1 (or negative)" });
    assert.deepEqual(f.writes, []);
    assert.equal(f.tables.entries.length, 0);
    assert.equal(f.tables.jobs.length, 0);
  });
}

for (const dose of [NaN, Infinity, -Infinity]) {
  test(`rejects a later ${String(dose)} dose without saving earlier valid pushes`, async () => {
    const f = fixture();
    await assert.rejects(f.submit([push(0.5), push(dose, 1)]), /Doses are/);
    assert.deepEqual(f.writes, []);
    assert.equal(f.tables.entries.length, 0);
    assert.equal(f.tables.jobs.length, 0);
  });
}

for (const [dose, rounded] of [[0.05, 0.05], [-0.05, -0.05], [1, 1], [-1, -1], [0.055, 0.06], [-0.055, -0.05]]) {
  test(`accepts dose ${dose} and preserves rounding to ${rounded}`, async () => {
    const f = fixture();
    await f.submit([push(dose)]);
    assert.deepEqual(f.writes.map(write => write.table), ["entries", "jobs"]);
    const [entry] = f.tables.entries;
    const [job] = f.tables.jobs;
    assert.deepEqual(entry.pushes, [push(rounded)]);
    assert.equal(entry.playerId, player._id);
    assert.equal(entry.status, "pending");
    assert.deepEqual(job, {
      _id: "jobs:1", kind: "judge", key: `judge:${entry._id}`, status: "pending", priority: 0,
      args: { entryId: entry._id, slug: "offline-bounty", pushes: [push(rounded)], prompts: ["offline prompt"], anchors: ["offline anchor"] },
    });
  });
}

test("allows multiple distinct neurons up to the bounty limit", async () => {
  const f = fixture({ maxNeurons: 3 });
  const pushes = [push(0.05), push(-0.5, 1), { layer: 31, n: 9215, dose: 1 }];
  await f.submit(pushes);
  assert.deepEqual(f.tables.entries[0].pushes, pushes);
  assert.deepEqual(f.tables.jobs[0].args.pushes, pushes);
  assert.equal(f.tables.jobs.length, 1);
});

for (const [name, pushes, error] of [
  ["empty pushes", [], /Use 1-3 neurons/],
  ["too many neurons", [push(0.5), push(0.5, 1), push(0.5, 2), push(0.5, 3)], /Use 1-3 neurons/],
  ["duplicate neuron", [push(0.5), push(-0.5)], /Each neuron once/],
  ["invalid coordinate", [{ layer: 32, n: 0, dose: 0.5 }], /no neuron/],
]) {
  test(`preserves rejection of ${name} without writes`, async () => {
    const f = fixture();
    await assert.rejects(f.submit(pushes), error);
    assert.deepEqual(f.writes, []);
  });
}

test("accepts the eighth entry and rejects the ninth without additional writes", async () => {
  const f = fixture({ entries: 7 });
  await f.submit([push(0.5)]);
  assert.equal(f.tables.entries.length, 8);
  assert.equal(f.tables.jobs.length, 1);
  const writes = [...f.writes];
  await assert.rejects(f.submit([push(-0.5)]), /Out of entries for this bounty \(8\)/);
  assert.deepEqual(f.writes, writes);
  assert.equal(f.tables.entries.length, 8);
  assert.equal(f.tables.jobs.length, 1);
});
