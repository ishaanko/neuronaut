import { heatBand } from "./heat";

export type ChartMark = { heat: number; correct?: boolean };

const W = 420;
const [TOP, BASE] = [12, 104]; // y of heat 99 and of heat 0, the baseline
const [LEFT, RIGHT] = [26, 10];

// A guess's marker, filled with its heat band's color (the heat bar's colors) and shaped by band so it reads without
// color too: cold ○, warm ▲, warmer ■, hot ●, and the hit as a larger green dot.
function Marker({ x, y, m }: { x: number; y: number; m: ChartMark }) {
  switch (heatBand(m.heat, m.correct)) {
    case "good":
      return <circle cx={x} cy={y} r={6.5} className="fill-good stroke-fg" strokeWidth={1.2} />;
    case "hot":
      return <circle cx={x} cy={y} r={5.5} className="fill-hot stroke-fg" strokeWidth={1.2} />;
    case "warmer":
      return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} className="fill-warmer stroke-fg" strokeWidth={1.2} />;
    case "warm":
      return <path d={`M${x} ${y - 5.5}l5.5 9.5h-11z`} className="fill-warm stroke-fg" strokeWidth={1.2} />;
    case "cold":
      return <circle cx={x} cy={y} r={4.5} className="fill-cold stroke-fg" strokeWidth={1.2} />;
  }
}

// A smooth line through the points (Catmull-Rom as cubic Béziers).
function curve(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function ChartLegend({ className = "" }: { className?: string }) {
  const items: [ChartMark, string][] = [
    [{ heat: 5 }, "cold"],
    [{ heat: 30 }, "warm"],
    [{ heat: 50 }, "warmer"],
    [{ heat: 80 }, "hot"],
    [{ heat: 100, correct: true }, "hit"],
  ];
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider ${className}`} aria-hidden>
      {items.map(([m, name]) => (
        <span key={name} className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="h-3 w-3">
            <Marker x={8} y={8} m={m} />
          </svg>
          {name}
        </span>
      ))}
    </div>
  );
}

// Each guess's heat in the order made, plotted over a ruler with one tick per guess allowed. A null mark is a guess still
// being scored: it keeps its slot and draws nothing, so later guesses don't shift when it lands. Static: it redraws when
// a guess lands, nothing animates.
export function HeatChart({ marks, slots, className = "" }: { marks: (ChartMark | null)[]; slots: number; className?: string }) {
  const x = (i: number) => LEFT + (i * (W - LEFT - RIGHT)) / Math.max(1, slots - 1);
  const y = (m: ChartMark) => BASE - ((m.correct ? 99 : m.heat) / 99) * (BASE - TOP);
  const plotted = marks.flatMap((m, i) => (m ? [{ m, px: x(i), py: y(m) }] : []));
  const pts = plotted.map(({ px, py }) => [px, py] as [number, number]);
  const label = marks.length ? `Heat of each guess: ${marks.map((m) => (!m ? "scoring" : m.correct ? "hit" : m.heat)).join(", ")}` : "No guesses yet";
  return (
    <svg viewBox={`0 0 ${W} 138`} className={`w-full ${className}`} role="img" aria-label={label}>
      <text x={0} y={TOP + 5} className="fill-dim font-mono text-[13px]">99</text>
      <text x={10} y={BASE + 4} className="fill-dim font-mono text-[13px]">0</text>
      {pts.map(([px, py], i) => (
        <line key={i} x1={px} x2={px} y1={py} y2={BASE} className="stroke-line-strong" strokeWidth={1} />
      ))}
      <line x1={LEFT - 6} x2={W} y1={BASE} y2={BASE} className="stroke-fg" strokeWidth={1.2} />
      {Array.from({ length: (slots - 1) * 4 + 1 }, (_, t) => {
        const tx = LEFT + (t * (W - LEFT - RIGHT)) / ((slots - 1) * 4);
        const major = t % 4 === 0;
        return <line key={t} x1={tx} x2={tx} y1={BASE + 6} y2={BASE + (major ? 14 : 10)} className="stroke-fg" strokeWidth={major ? 1.2 : 0.8} />;
      })}
      {Array.from({ length: slots }, (_, i) =>
        i === 0 || (i + 1) % 5 === 0 ? (
          <text key={i} x={x(i)} y={BASE + 28} textAnchor="middle" className="fill-dim font-mono text-[13px]">
            {i + 1}
          </text>
        ) : null,
      )}
      <path d={curve(pts)} fill="none" className="stroke-fg" strokeWidth={1.6} />
      {plotted.map(({ m, px, py }) => (
        <Marker key={px} x={px} y={py} m={m} />
      ))}
    </svg>
  );
}
