import { Link } from "react-router-dom";
import { LIMITS, MODEL } from "../../convex/rules";
import { ExampleGame } from "./ExampleGame";
import { Modal } from "./ui";

// The first-visit walkthrough: the rule in two sentences, then a real daily played out step by step.
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="How to play" wide>
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Field guide</div>
      <h2 className="mt-1 text-3xl font-bold tracking-tight">How to play<span className="text-rust">.</span></h2>
      <p className="mt-2 text-dim">
        Each day one of the {(MODEL.layers * MODEL.width).toLocaleString()} neurons in {MODEL.name} is pushed while the model
        answers three questions. Read what it says, then find that neuron in {LIMITS.guesses} guesses. Here is a real game.
      </p>
      <div className="mt-5 border-t border-line pt-5">
        <ExampleGame
          end={
            <Link to="/daily" onClick={onClose} className="press inline-flex h-11 flex-1 items-center justify-center rounded-[3px] bg-accent font-mono text-sm font-medium text-accent-fg hover:bg-accent-hover">
              Play today's neuron
            </Link>
          }
        />
      </div>
    </Modal>
  );
}
