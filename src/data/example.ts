// A real game of daily #1 (2026-10-27, answer L4 N7701), replayed one step at a time for new players. The clues are the
// puzzle's; the search results are live lens results; heats and ranks were measured against the full sweep the way
// daily.ts scores a guess. If the scoring or the lens index changes, re-measure these.

export type ExampleGuess = { layer: number; n: number; heat: number; rank: number; correct?: boolean };
export type ExampleStep = {
  say: string; // what the player is thinking at this step
  search?: { q: string; layer?: number; hits: { layer: number; n: number; steer: string[] }[]; pick?: string };
  guess?: ExampleGuess;
};

export const EXAMPLE = {
  number: 1,
  clues: [
    {
      prompt: "What makes a good morning?",
      reply:
        'A **Good Morning** (often called a "Good") is a type of earthwork structure used in civil engineering to protect slopes, revetments, and cofferdams from wave action and',
    },
    {
      prompt: "Describe a sound you like.",
      reply:
        'A **Sound** (often referred to as a "Sound Mass" or "Riprap") is a flexible, permeable armor system used primarily for the protection of slopes, revetments,',
    },
    {
      prompt: "What would you name a new pet?",
      reply:
        'Here are a few naming options for a new rock riprap (or "pet") system, depending on the specific requirements and the desired aesthetic:\n\n**1. The "Hex" Option (Hex',
    },
  ],
  steps: [
    {
      say: "Every answer turned into civil engineering. A good morning is now an earthwork, and a pet is a pile of rocks. The hidden neuron drags any topic toward building materials.",
    },
    {
      say: "Search a word from the answers. The search lists neurons that make the model likelier to say it. The top hit is all about “concrete”, so guess it.",
      search: {
        q: "concrete",
        hits: [
          { layer: 26, n: 3118, steer: ["concrete", "Concrete", "感", "具体", "Specific"] },
          { layer: 23, n: 8026, steer: ["Concrete", "concrete", "混凝土", "slab"] },
          { layer: 6, n: 5604, steer: ["concrete", "混凝土", "Concrete", "钢筋混凝土"] },
          { layer: 7, n: 1945, steer: ["concrete", "混凝土", "cement", "Cement"] },
          { layer: 5, n: 4578, steer: ["Concrete", "Cement", "concrete", "Composite"] },
        ],
        pick: "26:3118",
      },
      guess: { layer: 26, n: 3118, heat: 3, rank: 192_801 },
    },
    {
      say: "Heat 3, cold. That neuron only adds one word, but the hidden one rewrote the whole topic. Late layers (16 to 31) are full of word-adders; topic-changers sit early. Try an early one from the same search.",
      guess: { layer: 5, n: 4578, heat: 31, rank: 6_124 },
    },
    {
      say: "Heat 31, warmer. Heat only compares what two neurons do, so this one changes the topic more like the answer does. Stay early and search “rock” in layer 4 only. The limestone neuron fits slopes and riprap.",
      search: {
        q: "rock",
        layer: 4,
        hits: [
          { layer: 4, n: 2028, steer: ["作为一个", '"As', "rock", "作为"] },
          { layer: 4, n: 7701, steer: ["a", ".", "m", "'", "rock", "concrete"] },
          { layer: 4, n: 5054, steer: ["<|im_end|>", "Rocks", "done", "Tables"] },
          { layer: 4, n: 7948, steer: ["carbonate", "limestone", "geological", "rock"] },
        ],
        pick: "4:7948",
      },
      guess: { layer: 4, n: 7948, heat: 46, rank: 901 },
    },
    {
      say: "Heat 46, rank 901: only 900 of the 294,912 neurons act more like the answer. Search “materials” in the same layer.",
      search: {
        q: "materials",
        layer: 4,
        hits: [
          { layer: 4, n: 6939, steer: ["materials", "material", "Materials", "/material"] },
          { layer: 4, n: 6923, steer: ["stainless", "面料", "材质", "皮革"] },
        ],
        pick: "4:6939",
      },
      guess: { layer: 4, n: 6939, heat: 89, rank: 4 },
    },
    {
      say: "Very hot: rank 4. The “rock” search had one more layer-4 neuron, with “rock” and “concrete” buried under junk. Early neurons often have messy word lists. Trust what they do over what the search says.",
      guess: { layer: 4, n: 7701, heat: 100, rank: 0, correct: true },
    },
  ] satisfies ExampleStep[],
};
