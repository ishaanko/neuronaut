// A button's classes, for <button>s (Button) and for links styled as buttons.
export function buttonClass({ variant = "primary", size = "md" }: { variant?: "primary" | "ghost"; size?: "md" | "lg" } = {}) {
  const base =
    "press inline-flex items-center justify-center gap-2 rounded-[3px] font-mono font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none";
  const sizes = size === "lg" ? "h-12 px-6 text-[15px]" : "h-11 px-4 text-sm";
  const look = variant === "primary" ? "bg-accent text-accent-fg hover:bg-accent-hover" : "border border-fg text-fg hover:bg-raised";
  return `${base} ${sizes} ${look}`;
}
