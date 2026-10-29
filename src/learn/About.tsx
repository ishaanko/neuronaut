import { Link } from "react-router-dom";
import { MODEL } from "../../convex/rules";
import { PLACED, QUIET_SHARE } from "../map/zones";
import { Label, PageTitle } from "../ui/primitives";

// What a neuron is, why pushing one works, where this sits in interpretability, and who made it.
// The numbers follow worker/engine.py and worker/places.py, like the field notes; keep them in sync.

const PEOPLE = [
  {
    name: "Ishaan Kothari",
    links: [
      ["ishaanko.com", "https://ishaanko.com"],
      ["X", "https://x.com/ishaanko"],
      ["GitHub", "https://github.com/ishaanko"],
      ["LinkedIn", "https://www.linkedin.com/in/ishaanko"],
    ],
  },
  {
    name: "Prakhar Tiwari",
    links: [
      ["prakhart.com", "https://prakhart.com"],
      ["X", "https://x.com/tachymeters"],
      ["GitHub", "https://github.com/Prakhar-Tiwari-0"],
      ["LinkedIn", "https://www.linkedin.com/in/prakhartiw"],
    ],
  },
] as const;

const READING = [
  ["Zoom In: An Introduction to Circuits", "Olah et al., 2020", "https://distill.pub/2020/circuits/zoom-in/"],
  ["Toy Models of Superposition", "Elhage et al., 2022", "https://transformer-circuits.pub/2022/toy_model/index.html"],
  ["Towards Monosemanticity", "Bricken et al., 2023", "https://transformer-circuits.pub/2023/monosemantic-features/index.html"],
  ["Interpreting GPT: the logit lens", "nostalgebraist, 2020", "https://www.lesswrong.com/posts/AcKRB8wDpdaN6v6ru/interpreting-gpt-the-logit-lens"],
  ["Steering Language Models With Activation Engineering", "Turner et al., 2023", "https://arxiv.org/abs/2308.10248"],
] as const;

const link = "underline decoration-line-strong underline-offset-4 hover:decoration-fg";

export function About() {
  const neurons = (MODEL.layers * MODEL.width).toLocaleString();
  return (
    <div className="max-w-[720px] space-y-12 text-[16px] leading-relaxed">
      <div>
        <PageTitle>About</PageTitle>
        <p className="mt-3 text-dim">
          Neuronaut is a game played inside a real language model, {MODEL.name}. Every one of its {neurons} neurons is open to
          you. Push one while the model writes, see what changes, and work out what it does. Interpretability researchers do
          this for a living. We think you can learn it by playing.
        </p>
      </div>

      <section className="space-y-3">
        <Label className="mb-2">What a neuron is</Label>
        <p>
          The model writes one token at a time. Each token carries a list of numbers through {MODEL.layers} layers, called the
          residual stream. Every layer reads the stream and adds its own changes back in.
        </p>
        <p>
          Each layer has an attention part, which moves information between tokens, and an MLP, which works on each token
          alone. The MLP holds {MODEL.width.toLocaleString()} neurons. A neuron reads the stream, computes a single number, and
          adds a fixed direction to the stream, scaled by that number. That direction is the neuron's write direction. When the
          neuron fires, every layer after it sees that direction show up.
        </p>
      </section>

      <section className="space-y-3">
        <Label className="mb-2">Why pushing one works</Label>
        <p>
          A push skips the reading step. The game adds a neuron's write direction to the stream at every token, as if the neuron
          had fired hard on all of them, and lets the model keep writing. The dose sets how far. At 1.0 the push is as long as
          the stream usually is when it leaves that layer. Scans push at 0.6.
        </p>
        <p>
          Later layers can't tell a pushed direction from a real one. They read whatever is in the stream. If a direction means
          the sea to them, the reply drifts toward boats. Up close the network is nearly linear, so a small push moves it
          predictably. Push too far and the stream lands somewhere the model never saw in training, and the text loops, stutters
          or stops.
        </p>
        <p>
          We like pushing better than watching. A neuron that fires on sea words might only be noticing them. Pushing it shows
          what it does to the output, and that's the part that changes behavior.
        </p>
      </section>

      <section className="space-y-3">
        <Label className="mb-2">How the game measures it</Label>
        <p>
          Comparing replies word by word is hopeless, so the game compares what the model makes of them. After a pushed reply,
          an unpushed copy of the model reads it back, and we average its internal state over the reply at layer{" "}
          {Math.floor((2 * MODEL.layers) / 3)}. Subtract the state for a normal reply, subtract the change a random push of the
          same size causes, and the rest is the neuron's behavior embedding, stored as 256 numbers.
        </p>
        <p>
          Neurons with similar embeddings change the model in similar ways. A daily guess's heat is that similarity. Rarity is
          how big the change is next to random pushes. The <Link to="/map" className={link}>map</Link> lays out the{" "}
          {PLACED.toLocaleString()} neurons strong enough to place by their embeddings.
        </p>
      </section>

      <section className="space-y-3">
        <Label className="mb-2">Mechanistic interpretability</Label>
        <p>
          Mechanistic interpretability is the work of reverse-engineering a trained network. You read its weights and
          activations to find which parts compute what, instead of only grading its answers. Neurons were the first place
          people looked, because they're the units the model already has.
        </p>
        <p>
          They turned out messy. A model holds more concepts than it has neurons, so it spreads each concept across many neurons
          and packs several into each neuron. That's superposition. It's why about {Math.round(QUIET_SHARE * 100)}% of the neurons here barely do anything
          alone, and why one neuron can push the sea on one prompt and medicine on the next. Much of the field now hunts for
          cleaner directions with sparse autoencoders instead.
        </p>
        <p>
          We stuck with raw neurons anyway. They're what the model actually computes with, every one is fair game, and the
          clean ones are rare enough to be worth hunting. The <Link to="/notes" className={link}>field notes</Link> go deeper on
          each idea the first time the game shows it to you.
        </p>
      </section>

      <section>
        <Label className="mb-3">Further reading</Label>
        <ul className="space-y-2">
          {READING.map(([title, who, href]) => (
            <li key={href}>
              <a href={href} className={link}>
                {title}
              </a>
              <span className="block font-mono text-sm text-dim sm:ml-2 sm:inline">{who}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Label className="mb-3">Made by</Label>
        <div className="divide-y divide-line border-y border-line">
          {PEOPLE.map(({ name, links }) => (
            <div key={name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
              <span className="font-semibold">{name}</span>
              <span className="flex flex-wrap gap-x-4 font-mono text-sm">
                {links.map(([label, href]) => (
                  <a key={href} href={href} className={link}>
                    {label}
                  </a>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4">
          Built on{" "}
          <a href="https://github.com/lyramakesmusic/neuron-explorer" className={link}>
            neuron-explorer
          </a>{" "}
          by lyramakesmusic, where the steering method, the steer lens and the neuron index come from. The model is{" "}
          <a href={`https://huggingface.co/${MODEL.id}`} className={link}>
            {MODEL.name}
          </a>{" "}
          from the Qwen team. The source is on{" "}
          <a href="https://github.com/ishaanko/neuronaut" className={link}>
            GitHub
          </a>
          .
        </p>
      </section>
    </div>
  );
}
