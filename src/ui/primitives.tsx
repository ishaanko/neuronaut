import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "./styles";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Parameters<typeof buttonClass>[0];

export function Button({ variant, size, className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 border border-line bg-bg px-3 text-base outline-none placeholder:text-dim focus:border-fg ${className}`}
      {...props}
    />
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl font-bold">{children}</h1>;
}

// A section's heading.
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-semibold ${className}`}>{children}</h2>;
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
      <div className="truncate text-sm text-dim">{label}</div>
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-sm text-dim">{sub}</div>}
    </div>
  );
}

// A row of labelled facts, wrapping on narrow screens.
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4">
      {items.map((f) => (
        <div key={f.label}>
          <dt className="text-sm text-dim">{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div role="alert" className="text-sm font-medium text-glitch">
      {error}
    </div>
  ) : null;
}
