import { useMemo, type ReactNode } from "react";
import { asciiField } from "./ascii";

// The ASCII texture behind a panel. Static: drawn once per seed, never animated.
function Ascii({ seed }: { seed: string }) {
  const text = useMemo(() => asciiField(seed, 180, 48), [seed]);
  return (
    <pre aria-hidden className="ascii">
      {text}
    </pre>
  );
}

// A bordered panel. With `ascii`, a faint character field sits behind the content, seeded by that string.
export function Panel({ ascii, className = "", children }: { ascii?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`relative isolate overflow-hidden rounded-[3px] border border-line-strong bg-card ${className}`}>
      {ascii && <Ascii seed={ascii} />}
      <div className="relative">{children}</div>
    </div>
  );
}


// A registration mark at a plate's corner: a small circle with a cross through it.
function Corner({ at }: { at: string }) {
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={`absolute h-3.5 w-3.5 bg-bg text-fg ${at}`}>
      <circle cx="7" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export type PlateCell = { label: string; value: ReactNode };

// A field plate, like a printed specimen sheet: a double ruled frame with corner marks, a header strip (plate number
// left, a path right) and a row of captioned cells along the bottom. The game's main surfaces sit on one.
export function Plate({ no, path, cells, className = "", children }: { no?: ReactNode; path?: ReactNode; cells?: PlateCell[]; className?: string; children: ReactNode }) {
  return (
    <div className={`relative border-2 border-fg p-[5px] ${className}`}>
      <Corner at="-left-2 -top-2" />
      <Corner at="-right-2 -top-2" />
      <Corner at="-bottom-2 -left-2" />
      <Corner at="-bottom-2 -right-2" />
      <div className="border border-line-strong">
        {(no !== undefined || path) && (
          <div className="mx-4 flex items-baseline justify-between gap-4 border-b border-fg py-2.5 font-mono text-xs sm:mx-6">
            <span className="shrink-0 font-medium uppercase tracking-[0.14em]">{no !== undefined && <>Plate Nº {no}</>}</span>
            <span className="min-w-0 truncate text-dim">{path}</span>
          </div>
        )}
        <div className="px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        {cells && (
          <dl className="mx-4 grid grid-cols-2 gap-y-3 border-t border-fg py-3 sm:mx-6 sm:flex">
            {cells.map((c, i) => (
              <div key={c.label} className="min-w-0 pr-4 sm:flex-1 sm:border-l sm:border-line-strong sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
                <dt className={`font-mono text-[10px] font-medium uppercase tracking-[0.14em] ${i === 0 ? "text-rust" : "text-fg"}`}>{c.label}</dt>
                <dd className="mt-0.5 truncate">{c.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
