import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../app/theme";
import { dexNo } from "../neuron/format";
import { GRID as G, ZONES, zoneAt, zoneTint } from "./zones";

// The behavior map: neurons laid out by what pushing them does. Zones are tinted squares; dots are neurons this player
// may see, in ink: filled for their own, a ring for one someone else caught. Drawn once per change, nothing animates.

export type Dot = { layer: number; n: number; x: number; y: number; ring?: boolean; label?: string };

export function BehaviorMap({
  dots,
  onCell,
  selected,
  onDot,
}: {
  dots: Dot[];
  onCell: (cell: number) => void; // a click on a tinted square
  selected: number | null;
  onDot: (d: Dot) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<Dot | null>(null);
  const theme = useTheme(); // dots are drawn in the theme's ink, read when drawing

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
    const [ink, bg] = [css.getPropertyValue("--color-fg"), css.getPropertyValue("--color-bg")];
    const s = size / G;
    for (let i = 0; i < G * G; i++) {
      const z = zoneAt(i);
      if (!z) continue;
      g.fillStyle = zoneTint(z.id, bg, i === selected ? 0.75 : 0.35);
      // whole-pixel edges, so neighbouring squares meet without overlapping (overlaps show as darker seams)
      const [x0, y0] = [Math.round((i % G) * s), Math.round(Math.floor(i / G) * s)];
      g.fillRect(x0, y0, Math.round((i % G + 1) * s) - x0, Math.round((Math.floor(i / G) + 1) * s) - y0);
    }
    g.fillStyle = g.strokeStyle = ink;
    g.lineWidth = 2;
    for (const d of dots) {
      g.beginPath();
      g.arc(d.x * size, d.y * size, 3.5, 0, Math.PI * 2);
      if (d.ring) g.stroke();
      else g.fill();
    }
  }, [dots, size, selected, theme]);

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
    <div ref={box} className="relative aspect-square w-full select-none">
      <canvas
        ref={ref}
        style={{ width: size, height: size }}
        className="cursor-pointer"
        role="img"
        aria-label="Behavior map: neurons placed by what pushing them does"
        onMouseMove={(e) => setHover(nearest(...at(e)))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const [px, py] = at(e);
          const d = nearest(px, py);
          if (d) return onDot(d);
          const cell = Math.min(G - 1, Math.floor((py / size) * G)) * G + Math.min(G - 1, Math.floor((px / size) * G));
          if (zoneAt(cell)) onCell(cell);
        }}
      />
      {hover && (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap bg-fg px-2 py-1 font-mono text-sm text-bg"
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
  useTheme();
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg");
  return (
    <ul className="space-y-2.5">
      {list.map((z) => (
        <li key={z.id} className="flex gap-3">
          <span className="mt-1.5 h-3 w-3 shrink-0" style={{ background: zoneTint(z.id, bg) }} />
          <span>
            <span className="font-medium">{z.name}</span> <span className="text-dim">{z.blurb}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
