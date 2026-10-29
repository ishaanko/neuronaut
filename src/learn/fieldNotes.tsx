import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MODEL } from "../../convex/rules";
import { PLACED, QUIET_SHARE } from "../map/zones";

const ALL = (MODEL.layers * MODEL.width).toLocaleString();
const QUIET = `${Math.round(QUIET_SHARE * 100)}%`;

// Field notes: short lessons about how the model works, each unlocked the first time play shows it. Kept per browser.
// Every claim here should match what the code measures (worker/engine.py, worker/places.py); keep them in sync.
export const NOTES = [
  {
    id: "heat",
    title: "Heat compares effects, not numbers",
    unlock: "Score a daily guess.",
    body: [
      "To compare two neurons, the game pushes each one, lets the model write, then has the normal model read that writing back. How its internal state differs from reading a normal reply becomes the neuron's behavior embedding: 256 numbers.",
      `Heat ranks your guess by cosine similarity between its embedding and the answer's, among all ${ALL} neurons. Neighbouring neuron numbers mean nothing. Similar effects do.`,
    ],
  },
  {
    id: "lenses",
    title: "Steer lens and logit lens",
    unlock: "See a neuron that pushes its own words.",
    body: [
      "Each card shows two lists of words. The logit lens reads the neuron's output direction straight through the model's final layer, as if nothing came after it. The steer lens is measured: push the neuron, and see which next words become likelier.",
      "This neuron's steer-lens words showed up in its replies. Neurons like it sit mostly in layers 16 to 31: 6,211 of the 7,084 that do this.",
    ],
  },
  {
    id: "early",
    title: "Why early lenses look like noise",
    unlock: "See an early-layer neuron change the replies.",
    body: [
      "Layers after this one rework everything it writes, so reading its direction as if it were the last layer gives junk. Its logit lens is noise even when its effect is clear.",
      "Neuron 7429 in layer 5 works airports into every reply. Its steer lens shows it (Tokyo, Osaka, Seoul), while its logit lens reads '表面 洲 lette 秘密'. For early neurons, trust the effect and the steer lens, not the logit lens.",
    ],
  },
  {
    id: "breaks",
    title: "Pushed off the map",
    unlock: "See a neuron that breaks the text.",
    body: [
      "A push adds the neuron's direction to the model's internal state at every position. Too far, and that state is unlike anything the model saw in training. The layers after it can't make sense of it, and the text loops, stutters or goes silent.",
      `That is why so many of the strongest pushes break the text: about 23,000 of the ${PLACED.toLocaleString()} neurons strong enough to place.`,
    ],
  },
  {
    id: "quiet",
    title: "Most neurons are quiet",
    unlock: "Scan a neuron that barely does anything.",
    body: [
      `About ${QUIET} of neurons barely change the replies when pushed alone. A model stores its features spread across many neurons, and it has far more features than neurons, so features share them. That is called superposition.`,
      "One neuron on its own is often only a fragment of something. That is also why a few neurons are worth so much.",
    ],
  },
  {
    id: "focus",
    title: "Focused or context-dependent",
    unlock: "See a neuron bring up the same word everywhere.",
    body: [
      "This neuron brought up the same word in all four replies, whatever the question. Many don't: they push a different theme depending on the prompt.",
      "A neuron that stands for several unrelated things is called polysemantic, one of the signs of superposition. A focused neuron is the easiest kind to name.",
    ],
  },
  {
    id: "map",
    title: "Reading the map",
    unlock: "Open the map.",
    body: [
      "Each neuron's behavior embedding has 256 numbers. The map squeezes them into 2 with UMAP, which tries to keep neighbours next to each other. Close dots usually act alike, but long distances on the map mean little.",
      "The biggest pattern is depth. Early layers change tone and setting, late layers swap in specific words, and the far edges are where the text breaks.",
    ],
  },
  {
    id: "dose",
    title: "How hard to push",
    unlock: "Enter a bounty.",
    body: [
      "The dose is how far to push: 1.0 adds one typical layer's worth of size along the neuron's direction. A small dose nudges the topic, a big one takes over the reply, and past that the text breaks.",
      "Steering is a trade between effect and coherence, which is exactly what the bounty judge scores.",
    ],
  },
  {
    id: "combine",
    title: "Do effects add up?",
    unlock: "Run an experiment in the lab.",
    body: [
      "The lab has the model read the same normal reply three times: with one push, with the other, and with both. If the last layer changes by exactly the sum of the two separate changes, every layer in between acted linearly.",
      "Small pushes usually add up almost perfectly. Up close a network is nearly linear, which is why adding a direction steers it at all. Bigger pushes bend the sum, and two neurons pushing the same way often come out weaker than their total. The reply itself can still follow just one of them, since each word the model picks steers the rest.",
    ],
  },
] as const;

export type NoteId = (typeof NOTES)[number]["id"];
const KEY = "neuronaut:notes";
// The notes this browser has unlocked. Storage is the player's to edit, so anything that isn't a known note id is dropped.
const read = (): NoteId[] => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? NOTES.map((n) => n.id).filter((id) => saved.includes(id)) : [];
  } catch {
    return [];
  }
};

const Ctx = createContext<{ seen: NoteId[]; unlock: (id: NoteId) => void }>({ seen: [], unlock: () => {} });
export const useNotes = () => useContext(Ctx);

// Unlocks a note once its moment happens; does nothing until `when` is true.
export function useUnlock(id: NoteId, when: boolean) {
  const { unlock } = useNotes();
  useEffect(() => {
    if (when) unlock(id);
  }, [id, when, unlock]);
}

// Holds unlocked notes and shows a small card for each new one, bottom right, until dismissed or after 8 s.
export function NotesProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<NoteId[]>(read);
  const [fresh, setFresh] = useState<NoteId | null>(null);
  const unlock = useCallback((id: NoteId) => {
    setSeen((s) => {
      if (s.includes(id)) return s;
      const next = [...s, id];
      localStorage.setItem(KEY, JSON.stringify(next));
      setFresh(id);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 8000);
    return () => clearTimeout(t);
  }, [fresh]);
  const note = NOTES.find((x) => x.id === fresh);
  return (
    <Ctx.Provider value={{ seen, unlock }}>
      {children}
      {note && (
        <div role="status" className="note-in fixed inset-x-4 bottom-4 z-50 bg-fg p-4 text-bg sm:left-auto sm:w-96">
          <div className="text-sm">New field note</div>
          <div className="mt-1 text-lg font-semibold">{note.title}</div>
          <div className="mt-3 flex items-center gap-5 font-mono text-sm">
            <Link to={`/notes#${note.id}`} onClick={() => setFresh(null)} className="underline underline-offset-4">
              Read it
            </Link>
            <button onClick={() => setFresh(null)}>Later</button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
