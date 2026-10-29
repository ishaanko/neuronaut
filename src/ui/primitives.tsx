import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "./styles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Parameters<typeof buttonClass>[0];

export function Button({ variant, size, className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 rounded-[3px] border border-line-strong bg-card px-3 text-base outline-none placeholder:text-faint focus:border-fg ${className}`}
      {...props}
    />
  );
}

// A page's title, ending in a rust full stop.
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-4xl font-bold tracking-tight">
      {children}
      <span className="text-rust">.</span>
    </h1>
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
