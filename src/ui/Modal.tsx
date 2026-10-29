import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A centered dialog. Escape and the backdrop close it.
export function Modal({ open, onClose, children, label, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1b1814]/55 px-4 py-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`modal-panel max-h-full w-full overflow-y-auto border-2 border-fg bg-bg p-[5px] ${wide ? "max-w-[680px]" : "max-w-[480px]"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border border-line-strong p-5 sm:p-7">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
