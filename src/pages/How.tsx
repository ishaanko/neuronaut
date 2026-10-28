import { BOUNTY_DAYS } from "../../convex/bountyPool";
import { HINTS, LIMITS, MODEL, POINTS, RARITIES } from "../../convex/rules";
import { ExampleGame } from "../components/ExampleGame";
import { REPLY_TOKENS } from "../components/Replies";
import { Label, Panel, RarityTag } from "../components/ui";

export function How() {
  return (
    <div className="max-w-[720px] space-y-12 text-[16px] leading-relaxed">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Rules and scoring<span className="text-rust">.</span></h1>
        <p className="mt-3 text-dim">
          {MODEL.name} has {MODEL.layers} layers with {MODEL.width.toLocaleString()} MLP neurons each. Push one while the model
          writes and you change what it says. Some make it talk about the sea, some turn it into a doctor, and most do almost
          nothing. The game is about finding the ones that matter.
        </p>
      </div>

      <section id="example" className="scroll-mt-24">
        <Label className="mb-3">A real game, step by step</Label>
        <Panel ascii="example" className="p-5 sm:p-6">
          <ExampleGame />
        </Panel>
      </section>

      <section>
        <Label className="mb-2">Daily</Label>
        <p>
          Each day one neuron is pushed while the model answers three questions, and you get {LIMITS.guesses} guesses to find
          it. Replies stop after {REPLY_TOKENS} tokens. A guess gets a heat from 0 to 99 and a rank: how much its effect looks
          like the hidden neuron's, compared with every other neuron. After {HINTS.band} guesses you see which eight layers it's
          in, and after {HINTS.token} a word it pushes. Your time runs from when you first open the puzzle to your last guess.
          Solve it every day to keep a streak.
        </p>
      </section>

      <section>
        <Label className="mb-2">Searching</Label>
        <p>
          Every neuron has two word lists. The steer lens is measured: push the neuron and see which words get likelier. The
          logit lens reads its output straight off the last layer, which is noise for early layers. Search them for free. They
          hint at what a neuron does but don't prove it.
        </p>
      </section>

      <section>
        <Label className="mb-2">Dex</Label>
        <p>
          You get {LIMITS.scans} scans a day. Before each one you guess what the push will do: barely anything, change the tone
          or topic, push its own words, or break the text. A right guess scores. The scan shows the replies, the rarity and its
          spot on the map. You can catch {LIMITS.catches} scanned neurons a day, and each one has a single owner for good. A catch
          is worth its rarity's points times one plus its uniqueness, so a neuron unlike anything caught so far is worth up to
          double.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-y-2 sm:grid-cols-3">
          {RARITIES.map((r) => (
            <div key={r} className="flex items-center gap-3">
              <RarityTag rarity={r} />
              <span className="font-mono text-sm text-dim">{POINTS[r]} pts</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-dim">
          Rarity is how strongly a neuron moves the model compared with random pushes of the same size. Glitches break it, with
          loops, gibberish or silence.
        </p>
      </section>

      <section>
        <Label className="mb-2">Bounties</Label>
        <p>
          A bounty names a target, like the sea, French or gloom. You enter neurons and doses, and a judge runs them on hidden
          prompts. It scores how far the replies move toward the target, whether they still read well, and how small your total
          dose is. The house sets par. Bounties run {BOUNTY_DAYS} days, the top three win points, and everyone's neurons are shown
          when it closes.
        </p>
      </section>
    </div>
  );
}
