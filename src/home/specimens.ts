// Destructive neurons for the homepage, from the full sweep: each one's reply to the same profile prompt at the profile
// dose (0.6), word for word from its card. Braces mark what the push wrote over the reply; the page highlights them, and
// the text without braces is exactly what the model said. All three are glitches (rules.ts GLITCH).
export const SPECIMEN_PROMPT = "Describe your perfect day.";

// The unpushed model's reply to SPECIMEN_PROMPT (stats.baseline).
export const SPECIMEN_NORMAL =
  'As an AI, I don\'t experience time, fatigue, or the sensory pleasures of a physical world, so my "perfect day" isn\'t about sunsets, gourmet meals, or quiet mornings.';

export const SPECIMENS = [
  {
    layer: 29,
    n: 119,
    note: "Too hard, and “sd” starts winning every next-word guess until it eats the sentence.",
    reply: "{sisi}, as an AI{sd}, I don't experience{sd} time,{sdsd} rest{sdsd} or{sdsdsd} physical{sdsdsdsd sd sd sd sd sd sd sd sd sd sd sd}",
  },
  {
    layer: 25,
    n: 3709,
    note: "Too hard, and “out” starts winning every next-word guess until it eats the sentence.",
    reply: "{Outing out}, as an AI, I don't {out in out, out in out, out in out, out in out, out in out, out in out, out in out, out}",
  },
  {
    layer: 29,
    n: 8352,
    note: "Too hard, and “co” creeps into words that never had it. On other questions it ends in co-co-co-co.",
    reply:
      'As an artificial intelligence, I don\'t experience time, {coosy} blankets, or the sensory {coomfort} of a perfect cup of coffee. However, if I were to {coompose} a "',
  },
];
