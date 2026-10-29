import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const push = v.object({ layer: v.number(), n: v.number(), dose: v.number() });
export const ladder = v.object({ ranks: v.array(v.number()), cos: v.array(v.float64()) }); // see rules.ts ladderRank
export const jobKind = v.union(v.literal("profile"), v.literal("judge"), v.literal("daily"), v.literal("par"), v.literal("combo"));
export const effect = v.union(v.literal("quiet"), v.literal("shift"), v.literal("word"), v.literal("breaks")); // rules.ts EFFECTS

export default defineSchema({
  // One row, "global": totals and the dex coverage grid (layers x COVERAGE_BINS catch counts).
  // Also the profile prompts and the unsteered model's replies to them, which every card compares against.
  stats: defineTable({
    name: v.string(),
    profiled: v.number(),
    swept: v.optional(v.number()), // neurons the worker's sweep has measured (they live in its local store, not here)
    caught: v.number(),
    coverage: v.array(v.number()),
    prompts: v.optional(v.array(v.string())),
    baseline: v.optional(v.array(v.string())),
  }).index("by_name", ["name"]),

  // Every neuron in the model with its steer lens and logit lens tokens: the searchable index players hunt with.
  neurons: defineTable({
    layer: v.number(),
    n: v.number(),
    steer: v.array(v.string()), // tokens a push makes more likely, strongest first
    lens: v.array(v.string()), // logit lens of the write direction
    terms: v.string(), // search text built from both
  })
    .index("by_ln", ["layer", "n"])
    .searchIndex("search_terms", { searchField: "terms", filterFields: ["layer"] }),

  // What a neuron does, measured by the GPU worker. Hidden from a player until they scan or guess it, or it is caught.
  profiles: defineTable({
    key: v.string(), // "layer:n"
    layer: v.number(),
    n: v.number(),
    texts: v.array(v.string()), // steered replies to the profile prompts
    words: v.array(v.string()),
    z: v.number(), // strength against random directions
    nll: v.number(),
    distinct: v.number(),
    rarity: v.string(),
    embedding: v.array(v.float64()),
    caught: v.boolean(),
  })
    .index("by_key", ["key"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 256, filterFields: ["caught"] }),

  // The behavior map (worker/places.py), imported, not written by functions. One row per neuron strong enough to place:
  // x, y in [0, 1], the map square `cell` and its zone. Strong-but-broken pushes below the placing threshold get a row
  // with only `effect`. No row means quiet: pushed alone, it barely changes anything. Disclosed like a profile.
  places: defineTable({
    layer: v.number(),
    n: v.number(),
    effect: v.union(v.literal("shift"), v.literal("word"), v.literal("breaks")),
    zone: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    cell: v.optional(v.number()), // row * grid + column, the square of src/data/zones.json it falls in
    r: v.optional(v.number()), // uniform in [0, 1), to pick a random neuron in a square
    focus: v.optional(v.number()), // in how many of the 4 profile replies its most consistent word shows up
    focusWord: v.optional(v.string()),
  })
    .index("by_ln", ["layer", "n"])
    .index("by_cell_r", ["cell", "r"]),

  players: defineTable({
    handle: v.string(),
    handleLower: v.string(),
    userId: v.string(), // the Clerk identity's tokenIdentifier: one player per sign-in. Guests: "guest|<token>" (lib.ts)
    guest: v.optional(v.literal(true)), // plays the daily without an account; hidden from the leaderboard
    points: v.number(),
    caught: v.number(),
    dailySolved: v.number(),
    streak: v.number(),
    bestStreak: v.number(),
    lastSolved: v.optional(v.string()),
    bountyWins: v.number(),
    predicted: v.optional(v.number()), // scans with a prediction, and how many were right
    predictedRight: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_handle", ["handleLower"])
    .index("by_guest_points", ["guest", "points"]), // accounts (guest unset) by points, without reading guest rows

  // A player looking at a neuron's card. source "scan" spends a daily scan; "guess" comes free with a daily guess.
  scans: defineTable({
    playerId: v.id("players"),
    key: v.string(),
    layer: v.number(),
    n: v.number(),
    date: v.string(),
    source: v.union(v.literal("scan"), v.literal("guess")),
    prediction: v.optional(effect), // what the player said pushing it would do, before seeing it
    right: v.optional(v.boolean()),
  })
    .index("by_player", ["playerId"])
    .index("by_player_date", ["playerId", "date"])
    .index("by_player_key", ["playerId", "key"]),

  catches: defineTable({
    playerId: v.id("players"),
    key: v.string(),
    layer: v.number(),
    n: v.number(),
    name: v.string(),
    rarity: v.string(),
    points: v.number(),
    uniqueness: v.number(),
    date: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_rarity", ["rarity"])
    .index("by_player", ["playerId"])
    .index("by_player_date", ["playerId", "date"]),

  // Work for the GPU worker. key dedupes (one pending profile per neuron).
  jobs: defineTable({
    kind: jobKind,
    key: v.string(),
    args: v.any(),
    priority: v.number(), // 0 = a player is waiting, GUEST_PRIORITY (jobs.ts) = a guest is, 1 = background
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed")),
    startedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    by: v.optional(v.id("players")), // the player who asked, for their GPU budget
  })
    .index("by_status_priority", ["status", "priority"])
    .index("by_status_kind_priority", ["status", "kind", "priority"])
    .index("by_by_status", ["by", "status"])
    .index("by_key", ["key"]),

  // One row: when the worker last checked in (worker.ts heartbeat), so a guess that hangs can say the worker is down.
  heartbeats: defineTable({ at: v.number() }),

  dailies: defineTable({
    date: v.string(),
    key: v.string(),
    layer: v.number(),
    n: v.number(),
    prompts: v.array(v.string()),
    texts: v.array(v.string()),
    baseline: v.array(v.string()),
    embedding: v.array(v.float64()),
    ladder, // how close every measured neuron is to the answer, sampled by rank: guess ranks and heat come from it
    band: v.array(v.number()), // [lo, hi] layers, a hint
    hint: v.string(), // the answer's top steer token, a hint
    difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"))), // by weekday, worker/main.py
  }).index("by_date", ["date"]),

  guesses: defineTable({
    playerId: v.id("players"),
    date: v.string(),
    key: v.string(),
    layer: v.number(),
    n: v.number(),
    status: v.union(v.literal("pending"), v.literal("done")),
    heat: v.optional(v.number()),
    rank: v.optional(v.union(v.number(), v.null())),
    correct: v.optional(v.boolean()),
    cos: v.optional(v.number()), // behavior-embedding cosine to the answer; rank and heat come from it
    practice: v.optional(v.boolean()), // a past puzzle replayed: scored the same, pays nothing
  })
    .index("by_player_date", ["playerId", "date"])
    .index("by_key_status", ["key", "status"]),

  results: defineTable({
    playerId: v.id("players"),
    date: v.string(),
    solved: v.boolean(),
    guesses: v.number(),
    heats: v.array(v.number()),
    practice: v.optional(v.boolean()),
    seconds: v.optional(v.number()), // solve clock: first open (or first guess) to the last guess that counted
  })
    .index("by_player_date", ["playerId", "date"])
    .index("by_date", ["date"]),

  // When a player first opened a daily, so the solve clock includes reading the clues. One row per player and date.
  opens: defineTable({
    playerId: v.id("players"),
    date: v.string(),
  }).index("by_player_date", ["playerId", "date"]),

  // The lab: two neurons pushed separately and together, to see whether their effects add up (worker/main.py combo).
  // additivity: cosine between the joint effect and the sum of the separate ones; gain: the joint effect's size over the
  // sum's; towardA/B: cosine of the joint effect with each one alone. texts: the joint push's replies.
  experiments: defineTable({
    playerId: v.id("players"),
    a: push,
    b: push,
    date: v.string(),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    texts: v.optional(v.array(v.string())),
    additivity: v.optional(v.number()),
    gain: v.optional(v.number()),
    towardA: v.optional(v.number()),
    towardB: v.optional(v.number()),
    faint: v.optional(v.boolean()), // one of them barely does anything alone, so the cosines are mostly noise
  }).index("by_player_date", ["playerId", "date"]),

  bounties: defineTable({
    slug: v.string(),
    title: v.string(),
    brief: v.string(),
    maxNeurons: v.number(),
    prompts: v.array(v.string()), // hidden: the judge runs entries on these
    anchors: v.array(v.string()), // hidden: on-target example replies the par search reads (and the old judge used)
    question: v.optional(v.string()), // the judge asks the unsteered model this about each reply; absent on bounties opened before it
    startsAt: v.number(),
    endsAt: v.number(),
    par: v.optional(v.object({ score: v.number(), pushes: v.array(push) })),
    settled: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_ends", ["endsAt"]),

  entries: defineTable({
    bountyId: v.id("bounties"),
    playerId: v.id("players"),
    pushes: v.array(push),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    score: v.optional(v.number()),
    concept: v.optional(v.number()),
    coherence: v.optional(v.number()),
    texts: v.optional(v.array(v.string())),
  })
    .index("by_bounty", ["bountyId"])
    .index("by_player_bounty", ["playerId", "bountyId"]),
});
