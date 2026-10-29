import { defineSchema, defineTable } from "convex/server";
import { v, type PropertyValidators } from "convex/values";
import { EFFECTS, RARITIES } from "./rules";

export const push = v.object({ layer: v.number(), n: v.number(), dose: v.number() });
export const ladder = v.object({ ranks: v.array(v.number()), cos: v.array(v.float64()) }); // see rules.ts ladderRank
export const difficulty = v.union(v.literal("easy"), v.literal("medium"), v.literal("hard")); // by weekday, worker/main.py
export const effect = v.union(...EFFECTS.map((e) => v.literal(e)));
export const rarity = v.union(...RARITIES.map((r) => v.literal(r)));

// What the worker measures about a neuron (worker.ts putProfiles); a profile row adds its key, rarity and catch state.
export const measured = {
  layer: v.number(),
  n: v.number(),
  texts: v.array(v.string()), // steered replies to the profile prompts
  words: v.array(v.string()),
  z: v.number(), // strength against random directions
  nll: v.number(),
  distinct: v.number(),
  embedding: v.array(v.float64()),
};

// A generated puzzle as the worker hands it over (worker.ts putDaily); its row adds the answer's key.
export const puzzle = {
  date: v.string(),
  layer: v.number(),
  n: v.number(),
  prompts: v.array(v.string()),
  texts: v.array(v.string()),
  baseline: v.array(v.string()),
  embedding: v.array(v.float64()),
  ladder, // how close every measured neuron is to the answer, sampled by rank: guess ranks and heat come from it
  band: v.array(v.number()), // [lo, hi] layers, a hint
  hint: v.string(), // the answer's top steer token, a hint
  difficulty: v.optional(difficulty),
};

// Work for the GPU worker, one row shape per kind: `args` is what the worker (worker/main.py) reads. key dedupes (one
// pending profile per neuron).
const job = <K extends string, A extends PropertyValidators>(kind: K, args: A) =>
  v.object({
    kind: v.literal(kind),
    args: v.object(args),
    key: v.string(),
    priority: v.number(), // 0 = a player is waiting, GUEST_PRIORITY (jobs.ts) = a guest is, 1 = background
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed")),
    startedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    by: v.optional(v.id("players")), // the player who asked, for their GPU budget
  });
const jobRow = v.union(
  job("profile", { layer: v.number(), n: v.number() }),
  job("judge", {
    entryId: v.id("entries"),
    slug: v.string(),
    pushes: v.array(push),
    prompts: v.array(v.string()),
    anchors: v.array(v.string()),
    question: v.optional(v.string()), // absent on bounties opened before the yes/no judge
  }),
  job("par", {
    slug: v.string(),
    prompts: v.array(v.string()),
    anchors: v.array(v.string()),
    question: v.optional(v.string()),
    maxNeurons: v.number(),
    brief: v.string(),
  }),
  job("daily", { date: v.string(), exclude: v.array(v.string()) }),
  job("combo", { experimentId: v.id("experiments"), a: push, b: push }),
);
export const jobKind = v.union(...jobRow.members.map((m) => m.fields.kind));

export default defineSchema({
  // One row, "global" (stats.ts).
  stats: defineTable({
    name: v.string(),
    profiled: v.number(), // no longer counted (worker.ts putProfiles); swept replaced it
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
    ...measured,
    key: v.string(), // "layer:n"
    rarity,
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
    cell: v.optional(v.number()), // row * grid + column, the square of src/map/zones.json it falls in
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
    handle: v.optional(v.string()), // the catcher's, copied so lists don't read (and rerun on) their player row
    rarity,
    points: v.number(),
    uniqueness: v.number(),
    date: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_rarity", ["rarity"])
    .index("by_player", ["playerId"])
    .index("by_player_date", ["playerId", "date"]),

  jobs: defineTable(jobRow)
    .index("by_status_priority", ["status", "priority"])
    .index("by_status_kind_priority", ["status", "kind", "priority"])
    .index("by_by_status", ["by", "status"])
    .index("by_key", ["key"]),

  // One row: how many guest rows were made this minute (lib.ts guestPlayer, rules.ts NEW_GUESTS_PER_MINUTE).
  guestMints: defineTable({ minute: v.number(), count: v.number() }),

  // One row: the UTC date that queries treat as today (lib.ts queryToday). daily.ts roll writes it at 00:00 UTC.
  clock: defineTable({ today: v.string() }),

  // One row: when the worker last checked in (worker.ts heartbeat), so a guess that hangs can say the worker is down.
  heartbeats: defineTable({ at: v.number() }),

  dailies: defineTable({ ...puzzle, key: v.string() }).index("by_date", ["date"]),

  // How many played each puzzle live and how many solved it, counted as results come in (daily.ts bumpTally), so the
  // daily page and the archive never read every result. A puzzle doc is ~25 KB (its ladder), so the archive lists these.
  tallies: defineTable({
    date: v.string(),
    difficulty: v.optional(difficulty),
    players: v.number(),
    solvers: v.number(),
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
    ranked: v.optional(v.boolean()), // its standings rows are complete (bounties.ts ranking); unset on older bounties
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
    .index("by_bounty_status", ["bountyId", "status"])
    .index("by_player_bounty", ["playerId", "bountyId"]),

  // Each player's best judged entry on a bounty (bounties.ts rankEntry), so its leaderboard reads 50 small rows instead
  // of every entry with its replies. at: the entry's creation time, which breaks ties (earlier wins).
  standings: defineTable({
    bountyId: v.id("bounties"),
    playerId: v.id("players"),
    entryId: v.id("entries"),
    handle: v.string(),
    score: v.number(),
    neurons: v.number(),
    at: v.number(),
    negAt: v.number(), // -at, so reading by_bounty_rank descending puts the earlier entry first on a tie
  })
    .index("by_bounty_rank", ["bountyId", "score", "negAt"])
    .index("by_bounty_player", ["bountyId", "playerId"]),
});
