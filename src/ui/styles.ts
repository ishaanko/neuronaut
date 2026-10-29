// A button's classes, for <button>s (Button) and for links styled as buttons. Ink and paper only: hovering swaps them.
export function buttonClass({ variant = "primary", size = "md" }: { variant?: "primary" | "ghost"; size?: "md" | "lg" } = {}) {
  const base =
    "press inline-flex items-center justify-center gap-2 border border-fg font-mono font-medium whitespace-nowrap disabled:pointer-events-none disabled:border-line disabled:bg-bg disabled:text-dim";
  const sizes = size === "lg" ? "h-12 px-6 text-[15px]" : "h-11 px-4 text-sm";
  const look = variant === "primary" ? "bg-fg text-bg hover:bg-bg hover:text-fg" : "text-fg hover:bg-fg hover:text-bg";
  return `${base} ${sizes} ${look}`;
}

// An inline text button or link: underlined, ink on hover.
export const textLink = "underline decoration-line underline-offset-4 hover:decoration-fg";
