import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Rarity } from "../../convex/rules";
import { RARITY_COLOR, RARITY_MARKS, dexNo, heatBg } from "../lib/format";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost"; size?: "md" | "lg" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  const base =
    "press inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const sizes = size === "lg" ? "h-14 px-7 text-lg" : "h-11 px-5 text-[15px]";
  const look =
    variant === "primary"
      ? "bg-accent text-accent-fg hover:opacity-90"
      : "border-2 border-line-strong bg-card text-fg hover:border-dim";
  return <button className={`${base} ${sizes} ${look} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 rounded-xl border-2 border-line-strong bg-card px-3.5 text-base outline-none placeholder:text-faint focus:border-fg ${className}`}
      {...props}
    />
  );
}

// Layer / neuron number inputs side by side, big enough to type on a phone.
export function NeuronInput({ layer, n, onLayer, onN }: { layer: string; n: string; onLayer: (v: string) => void; onN: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 font-mono">
      <label className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-dim">L</span>
        <Input value={layer} onChange={(e) => onLayer(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="0-31" className="w-[4.5rem] text-center font-mono" inputMode="numeric" aria-label="layer" />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-dim">N</span>
        <Input value={n} onChange={(e) => onN(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0-9215" className="w-24 text-center font-mono" inputMode="numeric" aria-label="neuron" />
      </label>
    </div>
  );
}

export function NeuronLink({ layer, n, className = "" }: { layer: number; n: number; className?: string }) {
  return (
    <Link to={`/n/${layer}/${n}`} className={`font-pixel text-sm underline decoration-line-strong underline-offset-4 hover:decoration-fg ${className}`}>
      {dexNo(layer, n)}
    </Link>
  );
}

export function RarityTag({ rarity, className = "" }: { rarity: Rarity; className?: string }) {
  const marks = RARITY_MARKS[rarity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-pixel text-xs whitespace-nowrap uppercase tracking-wide ${RARITY_COLOR[rarity]} ${className}`}>
      <span className="inline-flex gap-[2px]">
        {Array.from({ length: Math.max(1, marks) }, (_, i) => (
          <span key={i} className={`pixel-mark ${marks === 0 ? "opacity-40" : ""}`} />
        ))}
      </span>
      {rarity}
    </span>
  );
}

// A daily guess's heat as a filled bar (0-99, or a hit). The fill animates once, when the guess is scored.
export function HeatBar({ heat, correct = false }: { heat: number | null; correct?: boolean }) {
  const pct = correct ? 100 : heat === null ? 0 : Math.max(4, heat);
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
      {heat !== null && <div className={`heat-fill h-full rounded-full ${heatBg(heat, correct)}`} style={{ width: `${pct}%` }} />}
    </div>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-xs font-semibold uppercase tracking-[0.08em] text-dim ${className}`}>{children}</div>;
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
    <div className="rounded-xl bg-raised px-4 py-3">
      <Label>{label}</Label>
      <div className="mt-1 font-mono text-2xl font-medium tabular-nums">{value}</div>
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

// Numbered directions at the top of a mode: what to do, in order.
export function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 rounded-xl border border-line bg-card p-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-sm font-semibold text-accent-fg">{i + 1}</span>
          <span className="text-[15px] leading-snug">{s}</span>
        </li>
      ))}
    </ol>
  );
}

// A centered dialog. Escape and the backdrop close it.
export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="modal-panel max-h-full w-full max-w-[520px] overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl sm:p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
