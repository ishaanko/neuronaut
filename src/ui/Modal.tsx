import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A dialog on a plain sheet over the whole page. Escape, Close and a click outside the content close it.
export function Modal({ open, onClose, children, label, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label} className="modal-backdrop fixed inset-0 z-50 overflow-y-auto bg-bg" onMouseDown={onClose}>
      <button onClick={onClose} className="fixed right-4 top-4 font-mono text-sm text-dim hover:text-fg sm:right-6">
        Close
      </button>
      <div className="flex min-h-full items-center justify-center px-4 py-16">
        <div className={`modal-panel w-full ${wide ? "max-w-[680px]" : "max-w-[480px]"}`} onMouseDown={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
