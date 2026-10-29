import { useState } from "react";
import { errorText } from "../ui/errors";
import { Modal } from "../ui/Modal";
import { Button, ErrorLine, Input } from "../ui/primitives";

// Asks a newly signed-in user for the handle they'll play under.
export function JoinDialog({ onJoin, onClose, onSignOut }: { onJoin: (handle: string) => Promise<void>; onClose: () => void; onSignOut: () => void }) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      await onJoin(handle);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} label="Pick a handle">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <h2 className="text-xl font-semibold">Pick a handle</h2>
        <p className="mt-1 text-dim">This is the name other players see. You can't change it later.</p>
        <div className="mt-4">
          <Input autoFocus value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle" maxLength={16} className="w-full" />
        </div>
        <div className="mt-2 min-h-4">
          <ErrorLine error={error} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className="text-sm text-dim underline underline-offset-4 hover:text-fg" onClick={onSignOut}>
            Use a different account
          </button>
          <Button disabled={busy}>Start</Button>
        </div>
      </form>
    </Modal>
  );
}
