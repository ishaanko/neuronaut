// Soft noise drawn in characters, for the static texture behind panels (components/ui.tsx Ascii). The same seed always
// draws the same field, so a neuron or a bounty keeps its pattern between visits.
const RAMP = " .·:-=+*#%";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function asciiField(seed: string, cols: number, rows: number) {
  let h = hash(seed);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 2 ** 32);
  // a few slanted waves at random angles and scales; where they line up the field gets dense
  const waves = Array.from({ length: 4 }, () => {
    const a = rand() * Math.PI;
    const f = 0.05 + rand() * 0.12;
    return { fx: Math.cos(a) * f, fy: Math.sin(a) * f * 2.2, p: rand() * Math.PI * 2 };
  });
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const v = waves.reduce((s, w) => s + Math.sin(x * w.fx + y * w.fy + w.p), 0) / waves.length; // -1..1
      const t = Math.max(0, Math.min(0.999, (v + 1) / 2)) ** 1.3;
      line += RAMP[Math.floor(t * RAMP.length)];
    }
    lines.push(line);
  }
  return lines.join("\n");
}
