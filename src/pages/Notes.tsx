import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { NOTES, useNotes } from "../lib/notes";

// The notebook: every field note, the unlocked ones readable, the rest showing how to find them.
export function Notes() {
  const { seen } = useNotes();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);
  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Field notes<span className="text-rust">.</span></h1>
        <p className="mt-1 text-dim">
          {seen.length} of {NOTES.length} found. Each one unlocks the first time you see it happen in the game.
        </p>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {NOTES.map((note) => {
          const open = seen.includes(note.id);
          return (
            <article
              key={note.id}
              id={note.id}
              className="scroll-mt-24 py-6"
            >
              <h2 className={`text-xl font-semibold ${open ? "" : "text-dim"}`}>{open ? note.title : "Not found yet"}</h2>
              {open ? (
                <div className="mt-3 space-y-3 text-[16px] leading-relaxed">
                  {note.body.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-dim">{note.unlock}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
