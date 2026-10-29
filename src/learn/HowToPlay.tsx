import { Link } from "react-router-dom";
import { LIMITS, MODEL } from "../../convex/rules";
import { Modal } from "../ui/Modal";
import { buttonClass } from "../ui/styles";
import { ExampleGame } from "./ExampleGame";

// The first-visit walkthrough: the rule in two sentences, then a real daily played out step by step.
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="How to play" wide>
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Field guide</div>
      <h2 className="mt-1 text-3xl font-bold tracking-tight">How to play<span className="text-rust">.</span></h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-dim">
        <li>
          {MODEL.name} is a small language model with {(MODEL.layers * MODEL.width).toLocaleString()} neurons. Each day we turn
          one of them way up while it answers three questions, so its answers come out strange.
        </li>
        <li>
          Find that neuron. Every neuron has an address: a layer from 0 to {MODEL.layers - 1} and a number from 0 to{" "}
          {MODEL.width - 1}. You get {LIMITS.guesses} guesses.
        </li>
        <li>
          Each guess gets a heat from 0 to 99: how much your neuron bends the answers the same way the hidden one does. Heat
          is about what a neuron does, not where it sits. A guess one layer off can be cold, and one twenty layers off can be
          hot.
        </li>
        <li>Search words from the strange answers to find neurons that make the model say them.</li>
      </ol>
      <p className="mt-3 text-dim">Here is a real game.</p>
      <div className="mt-5 border-t border-line pt-5">
        <ExampleGame
          end={
            <Link to="/daily" onClick={onClose} className={`${buttonClass()} flex-1`}>
              Play today's neuron
            </Link>
          }
        />
      </div>
    </Modal>
  );
}
