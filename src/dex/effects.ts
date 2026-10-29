import type { Effect } from "../../convex/rules";

// What each effect looks like in the replies, for predictions and cards.
export const EFFECT_TEXT: Record<Effect, { name: string; looks: string }> = {
  quiet: { name: "Barely anything", looks: "The replies stay about the same." },
  shift: { name: "Changes tone or topic", looks: "Still fluent, but about something else or in another voice." },
  word: { name: "Pushes its own words", looks: "Its steer-lens words show up in the replies." },
  breaks: { name: "Breaks the text", looks: "Loops, stutters or silence." },
};
