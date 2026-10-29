import { Link } from "react-router-dom";
import { MODEL, type Rarity } from "../../convex/rules";
import { Input } from "../ui/primitives";
import { RARITY_COLOR, dexNo } from "./format";

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

// How hard to push a neuron (bounty entries, lab experiments). The backend checks the range.
export function DoseInput({ value, onChange, label = "dose" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-dim">Dose</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="w-20 text-center font-mono" inputMode="decimal" aria-label={label} />
    </label>
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

const HAN = /[㐀-鿿]/; // Chinese characters

// Shown under word lists that contain Chinese tokens, which surprise players who expect English only.
export function ChineseNote({ tokens, className = "" }: { tokens: string[]; className?: string }) {
  if (!tokens.some((t) => HAN.test(t))) return null;
  return (
    <p className={`text-sm text-dim ${className}`}>
      Why Chinese? {MODEL.name} learned from a lot of Chinese text, and many neurons hold one idea in both languages, so
      a concrete neuron pushes both concrete and 混凝土.
    </p>
  );
}
