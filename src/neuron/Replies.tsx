import type { ReactNode } from "react";
import { REPLY_TOKENS } from "../../convex/rules";

// **bold** inside a line. A ** left open by the token cut is dropped.
function inline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part.replace(/\*\*/g, "")
    ),
  );
}

// One model reply. The model writes markdown, so headings and bold render as such instead of showing their
// asterisks and hashes. A reply that stopped mid-sentence ends with a faint ellipsis.
export function Reply({ text, className = "" }: { text: string; className?: string }) {
  const t = text.trim();
  if (!t) return <p className={`text-dim ${className}`}>Nothing. The model stopped right away.</p>;
  // finished means it ends on a full stop, maybe inside a closing quote or bracket: a bare `"ocean"` may still be mid-sentence
  const cut = !/[.!?…]["'”»)\]]*$/.test(t);
  const lines = t.split("\n");
  return (
    <div className={`space-y-1.5 text-[15px] leading-relaxed ${className}`}>
      {lines.map((raw, i) => {
        if (!raw.trim()) return null;
        const heading = /^\s*#{1,6}\s+/.test(raw);
        const line = raw.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "• ");
        return (
          <p key={i} className={heading ? "font-semibold" : ""}>
            {inline(line)}
            {cut && i === lines.length - 1 && (
              <span className="text-dim" title={`Replies stop after ${REPLY_TOKENS} tokens`}>
                …
              </span>
            )}
          </p>
        );
      })}
    </div>
  );
}

// Steered replies next to another set of replies to the same prompts (the unsteered model's, by default), one row per
// prompt.
export function Replies({
  prompts,
  steered,
  baseline,
  steeredLabel = "With this neuron pushed",
  baselineLabel = "Normal",
}: {
  prompts: string[];
  steered: string[];
  baseline?: string[];
  steeredLabel?: string;
  baselineLabel?: string;
}) {
  return (
    <div className="space-y-8">
      {prompts.map((p, i) => (
        <div key={i}>
          <div className="font-semibold">{p}</div>
          <div className={`mt-2 grid gap-5 ${baseline ? "md:grid-cols-2" : ""}`}>
            <div>
              <div className="mb-1 text-sm text-dim">{steeredLabel}</div>
              <Reply text={steered[i] ?? ""} />
            </div>
            {baseline && (
              <div>
                <div className="mb-1 text-sm text-dim">{baselineLabel}</div>
                <Reply text={baseline[i] ?? ""} className="text-dim" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
