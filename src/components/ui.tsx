import { useEffect, useMemo, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MODEL, type Rarity } from "../../convex/rules";
import { asciiField } from "../lib/ascii";
import { RARITY_COLOR, dexNo, heatBg } from "../lib/format";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost"; size?: "md" | "lg" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  const base =
    "press inline-flex items-center justify-center gap-2 rounded-[3px] font-mono font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none";
  const sizes = size === "lg" ? "h-12 px-6 text-[15px]" : "h-11 px-4 text-sm";
  const look = variant === "primary" ? "bg-accent text-accent-fg hover:bg-[#3a342c]" : "border border-fg text-fg hover:bg-raised";
  return <button className={`${base} ${sizes} ${look} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 rounded-[3px] border border-line-strong bg-card px-3 text-base outline-none placeholder:text-faint focus:border-fg ${className}`}
      {...props}
    />
  );
}

// Layer and neuron number inputs side by side, each with its range written above it.
export function NeuronInput({ layer, n, onLayer, onN }: { layer: string; n: string; onLayer: (v: string) => void; onN: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <label className="block">
        <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-dim">Layer 0-{MODEL.layers - 1}</span>
        <Input value={layer} onChange={(e) => onLayer(e.target.value.replace(/\D/g, "").slice(0, 2))} className="w-16 text-center font-mono" inputMode="numeric" aria-label="layer" />
      </label>
      <label className="block">
        <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-dim">Neuron 0-{MODEL.width - 1}</span>
        <Input value={n} onChange={(e) => onN(e.target.value.replace(/\D/g, "").slice(0, 4))} className="w-24 text-center font-mono" inputMode="numeric" aria-label="neuron" />
      </label>
    </div>
  );
}

export function NeuronLink({ layer, n, className = "" }: { layer: number; n: number; className?: string }) {
  return (
    <Link to={`/n/${layer}/${n}`} className={`font-mono text-sm underline decoration-line-strong underline-offset-4 hover:decoration-fg ${className}`}>
      {dexNo(layer, n)}
    </Link>
  );
}

export function RarityTag({ rarity, className = "" }: { rarity: Rarity; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-xs ${RARITY_COLOR[rarity]} ${className}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {rarity}
    </span>
  );
}

// A daily guess's heat as a filled bar (0-99, or a hit). The fill animates once, when the guess is scored.
export function HeatBar({ heat, correct = false }: { heat: number | null; correct?: boolean }) {
  const pct = correct ? 100 : heat === null ? 0 : Math.max(4, heat);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
      {heat !== null && <div className={`heat-fill h-full rounded-full ${heatBg(heat, correct)}`} style={{ width: `${pct}%` }} />}
    </div>
  );
}

// A section's heading, set like a plate's caption: small mono capitals in ink.
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-mono text-xs font-medium uppercase tracking-[0.14em] text-fg ${className}`}>{children}</h2>;
}

// Wide content scrolls inside the page. The region is a tab stop so a keyboard can reach columns that are not links;
// that's an extra stop on desktop too, where nothing overflows.
export function ScrollX({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`max-w-full overflow-x-auto overscroll-x-contain ${className}`}>
      {children}
    </div>
  );
}

export function Tokens({ tokens, className = "" }: { tokens: string[]; className?: string }) {
  return (
    <span className={`font-mono text-sm ${className}`}>
      {tokens.map((t, i) => (
        <span key={i} className="mr-2 inline-block">
          {t}
        </span>
      ))}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div role="alert" className="text-sm font-medium text-glitch">
      {error}
    </div>
  ) : null;
}

// The ASCII texture behind a panel. Static: drawn once per seed, never animated.
export function Ascii({ seed }: { seed: string }) {
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

// A centered dialog. Escape and the backdrop close it.
export function Modal({ open, onClose, children, label, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1b1814]/55 px-4 py-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`modal-panel max-h-full w-full overflow-y-auto border-2 border-fg bg-bg p-[5px] ${wide ? "max-w-[680px]" : "max-w-[480px]"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border border-line-strong p-5 sm:p-7">{children}</div>
      </div>
    </div>,
    document.body,
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
