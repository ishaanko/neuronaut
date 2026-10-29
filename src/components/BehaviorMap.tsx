import { useEffect, useMemo, useRef, useState } from "react";
import zones from "../data/zones.json";
import { dexNo } from "../lib/format";

// The behavior map (worker/places.py writes src/data/zones.json): neurons laid out by what pushing them does. Zones are
// tinted squares; dots are neurons this player may see. Drawn once per change, nothing animates.

export const ZONES = zones.zones;
export type ZoneId = (typeof zones.zones)[number]["id"];
const G = zones.grid;
const TINT: Record<string, string> = {
  silence: "#8a8a8a",
  stutter: "#d16ba5",
  derail: "#c2410c",
  tone: "#0ea5e9",
  self: "#8b5cf6",
  drift: "#14b8a6",
  rewrite: "#eab308",
  words: "#22c55e",
  phrase: "#f97316",
  loop: "#ef4444",
};
export const zoneTint = (id: string) => TINT[id] ?? "#888";
export const zoneAt = (cell: number) => {
  const ch = zones.cells[cell];
  return ch && ch !== "." ? ZONES[ch.charCodeAt(0) - 97] : null;
};

// color: a hex value, or a theme variable like "--color-fg" (read from the stylesheet when drawing).
export type Dot = { layer: number; n: number; x: number; y: number; color: string; size?: number; ring?: boolean; label?: string };

export function BehaviorMap({
  dots,
  onCell,
  selected,
  onDot,
  labels = true,
  tint = true,
  className = "",
}: {
  dots: Dot[];
  onCell?: (cell: number) => void; // a click on a tinted square
  selected?: number | null;
  onDot?: (d: Dot) => void;
  labels?: boolean;
  tint?: boolean; // false draws every zone in one grey, so the dots' colors are the only ones that mean something
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<Dot | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !size) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = size * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size, size);
    const css = getComputedStyle(document.documentElement);
    const paint = (c: string) => (c.startsWith("--") ? css.getPropertyValue(c).trim() : c);
    const s = size / G;
    for (let i = 0; i < G * G; i++) {
      const z = zoneAt(i);
      if (!z) continue;
      g.globalAlpha = i === selected ? 0.75 : 0.32;
      g.fillStyle = tint ? zoneTint(z.id) : paint("--color-line-strong");
      // whole-pixel edges, so neighbouring squares meet without overlapping (overlaps show as darker seams)
      const [x0, y0] = [Math.round((i % G) * s), Math.round(Math.floor(i / G) * s)];
      g.fillRect(x0, y0, Math.round((i % G + 1) * s) - x0, Math.round((Math.floor(i / G) + 1) * s) - y0);
    }
    g.globalAlpha = 1;
    for (const d of dots) {
      const r = d.size ?? 3.5;
      g.beginPath();
      g.arc(d.x * size, d.y * size, r, 0, Math.PI * 2);
      if (d.ring) {
        g.lineWidth = 2;
        g.strokeStyle = paint(d.color);
        g.stroke();
      } else {
        g.fillStyle = paint(d.color);
        g.fill();
      }
    }
  }, [dots, size, selected, tint]);

  const nearest = (px: number, py: number) => {
    let best: Dot | null = null;
    let bd = 12 ** 2;
    for (const d of dots) {
      const dd = (d.x * size - px) ** 2 + (d.y * size - py) ** 2;
      if (dd < bd) [best, bd] = [d, dd];
    }
    return best;
  };
  const at = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div ref={box} className={`relative aspect-square w-full select-none ${className}`}>
      <canvas
        ref={ref}
        style={{ width: size, height: size }}
        className={onCell || onDot ? "cursor-pointer" : ""}
        role="img"
        aria-label="Behavior map: neurons placed by what pushing them does"
        onMouseMove={(e) => setHover(nearest(...at(e)))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const [px, py] = at(e);
          const d = nearest(px, py);
          if (d && onDot) return onDot(d);
          const cell = Math.min(G - 1, Math.floor((py / size) * G)) * G + Math.min(G - 1, Math.floor((px / size) * G));
          if (onCell && zoneAt(cell)) onCell(cell);
        }}
      />
      {labels &&
        ZONES.map((z) => (
          <span
            key={z.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-bg/85 px-1 font-mono text-[9px] uppercase leading-tight tracking-wider text-fg sm:text-[10px]"
            style={{ left: `${Math.min(0.9, Math.max(0.1, z.x)) * 100}%`, top: `${Math.min(0.96, Math.max(0.04, z.y)) * 100}%` }}
          >
            {z.name}
          </span>
        ))}
      {hover && (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-[3px] bg-accent px-2 py-1 font-mono text-xs text-accent-fg"
          style={{ left: hover.x * size, top: hover.y * size }}
        >
          {dexNo(hover.layer, hover.n)}
          {hover.label ? ` · ${hover.label}` : ""}
        </span>
      )}
    </div>
  );
}

// The map's zones as a legend: each zone's color, name and what its neurons tend to do.
export function ZoneLegend({ only }: { only?: string }) {
  const list = useMemo(() => (only ? ZONES.filter((z) => z.id === only) : ZONES), [only]);
  return (
    <ul className="space-y-2.5">
      {list.map((z) => (
        <li key={z.id} className="flex gap-3">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: zoneTint(z.id) }} />
          <span>
            <span className="font-medium">{z.name}</span> <span className="text-dim">{z.blurb}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
