import { Link } from "react-router-dom";
import { LIMITS, MODEL } from "../../convex/rules";
import { Modal } from "../ui/Modal";
import { buttonClass } from "../ui/styles";
import { ExampleGame } from "./ExampleGame";

// The first-visit walkthrough: the rule in two sentences, then a real daily played out step by step.
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="How to play" wide>
      <h2 className="text-3xl font-bold">How to play</h2>
      <div className="mt-3 space-y-3">
        <p>
          {MODEL.name} is a small language model with {(MODEL.layers * MODEL.width).toLocaleString()} neurons. Each day we turn
          one of them way up while it answers three questions, so its answers come out strange.
        </p>
        <p>
          Find that neuron. Every neuron has an address: a layer from 0 to {MODEL.layers - 1} and a number from 0 to{" "}
          {MODEL.width - 1}. You get {LIMITS.guesses} guesses.
        </p>
        <p>
          Each guess gets a heat from 0 to 99: how much your neuron bends the answers the same way the hidden one does. Heat
          is about what a neuron does, not where it sits. A guess one layer off can be cold, and one twenty layers off can be
          hot.
        </p>
        <p>Search words from the strange answers to find neurons that make the model say them. Here is a real game.</p>
      </div>
      <div className="mt-10">
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
