import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { EFFECTS, type Effect, MODEL, POINTS, PREDICT_POINTS, isNeuron } from "../../convex/rules";
import { useUnlock } from "../learn/fieldNotes";
import { ZONES } from "../map/zones";
import { dexNo } from "../neuron/format";
import { ChineseNote, RarityTag, Tokens } from "../neuron/parts";
import { Replies } from "../neuron/Replies";
import { useSession } from "../players/session";
import { errorText } from "../ui/errors";
import { Button, ErrorLine, Facts, Input, Label } from "../ui/primitives";
import { textLink } from "../ui/styles";
import { EFFECT_TEXT } from "./effects";

export function Neuron() {
  const params = useParams();
  const layer = Number(params.layer);
  const n = Number(params.n);
  const valid = isNeuron(layer, n);
  const { me, guest, requireJoin } = useSession();
  const card = useQuery(api.neurons.card, valid ? { layer, n, guest } : "skip");
  const overview = useQuery(api.neurons.overview);
  const scan = useMutation(api.neurons.scan);
  const catchNeuron = useAction(api.neurons.catchNeuron);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [caught, setCaught] = useState<{ points: number; uniqueness: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const effect = card?.effect ?? null;
  useUnlock("lenses", effect === "word");
  useUnlock("early", effect === "shift" && layer < 8);
  useUnlock("breaks", effect === "breaks");
  useUnlock("quiet", effect === "quiet");
  useUnlock("focus", effect !== "breaks" && card?.focus?.n === 4);

  if (!valid) return <p className="py-20 text-center text-dim">No such neuron.</p>;
  if (card === undefined) return <p className="py-20 text-center text-dim">Loading…</p>;

  const doScan = async (prediction: Effect) => {
    setError(null);
    const ok = await requireJoin();
    if (!ok) return;
    try {
      await scan({ layer, n, prediction });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const doCatch = async () => {
    setError(null);
    const ok = await requireJoin();
    if (!ok || !card.profile) return;
    setBusy(true);
    try {
      const r = await catchNeuron({ layer, n, name: name.trim() || card.profile.words[0] || dexNo(layer, n) });
      setCaught(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const p = card.profile;
  const prev = n > 0 ? [layer, n - 1] : layer > 0 ? [layer - 1, MODEL.width - 1] : null;
  const next = n < MODEL.width - 1 ? [layer, n + 1] : layer < MODEL.layers - 1 ? [layer + 1, 0] : null;

  return (
    <div className="mx-auto max-w-[920px] space-y-12">
      <div className="flex items-center gap-3 font-mono text-sm text-dim">
        {prev && <Link to={`/n/${prev[0]}/${prev[1]}`} className="py-1 hover:text-fg">&larr; {dexNo(prev[0], prev[1])}</Link>}
        {next && <Link to={`/n/${next[0]}/${next[1]}`} className="ml-auto py-1 hover:text-fg">{dexNo(next[0], next[1])} &rarr;</Link>}
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h1 className="font-mono text-5xl font-medium">{dexNo(layer, n)}</h1>
            {card.caught && <span className="text-3xl font-bold">{card.caught.name}</span>}
            {p && <RarityTag rarity={p.rarity} />}
          </div>
          <div className="mt-2 text-dim">
            Layer {layer}, neuron {n}
            {card.caught && (
              <>
                , caught by{" "}
                <Link to={`/t/${card.caught.handle}`} className={`font-semibold text-fg ${textLink}`}>
                  {card.caught.handle}
                </Link>{" "}
                for {card.caught.points} pts
              </>
            )}
          </div>
        </div>
        {p && (
          <Facts
            items={[
              { label: "Strength vs random", value: <span className="font-mono">{p.z.toFixed(1)}</span> },
              { label: "Coherence, lower is cleaner", value: <span className="font-mono">{p.nll.toFixed(2)}</span> },
              { label: "Variety, 1 is no loops", value: <span className="font-mono">{p.distinct.toFixed(2)}</span> },
              { label: "Worth, more if unique", value: <span className="font-mono">{POINTS[p.rarity]} pts</span> },
            ]}
          />
        )}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label>Steer lens</Label>
            <p className="text-sm text-dim">Words that get likelier when it's pushed</p>
            <Tokens tokens={card.steer} className="mt-2 block" />
          </div>
          <div>
            <Label>Logit lens</Label>
            <p className="text-sm text-dim">Its output read straight off the last layer</p>
            <Tokens tokens={card.lens} className="mt-2 block text-dim" />
          </div>
          <ChineseNote tokens={[...card.steer, ...card.lens]} className="md:col-span-2" />
        </div>
      </div>

      {card.status === "hidden" && (
        <section>
          <h2 className="text-xl font-semibold">What will pushing it do?</h2>
          <p className="mt-1 text-dim">
            Guess from its layer ({layer} of {MODEL.layers - 1}) and the two lenses above. Picking one spends a scan and runs the
            model. A right guess is worth {PREDICT_POINTS} points.
          </p>
          <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {EFFECTS.map((e) => (
              <button key={e} onClick={() => doScan(e)} disabled={!!me && me.scansLeft <= 0} className="group text-left disabled:pointer-events-none disabled:text-dim">
                <div className={`font-medium ${textLink}`}>{EFFECT_TEXT[e].name}</div>
                <div className="text-sm text-dim">{EFFECT_TEXT[e].looks}</div>
              </button>
            ))}
          </div>
          {me && <div className="mt-4 text-sm text-dim">{me.scansLeft} scans left today</div>}
          <div className="mt-2"><ErrorLine error={error} /></div>
        </section>
      )}

      {effect && <Effects card={card} effect={effect} />}

      {card.status === "pending" && <p className="text-lg text-dim">Running the model with it pushed. Usually a few seconds.</p>}

      {p && (
        <>
          {p.words.length > 0 && (
            <div>
              <Label>Words it brings up</Label>
              <Tokens tokens={p.words} className="mt-2 block text-base text-dim" />
            </div>
          )}

          {!card.caught && !caught && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doCatch();
              }}
            >
              <h2 className="text-xl font-semibold">Catch it</h2>
              <p className="mt-1 text-dim">Give it a name and it's yours for good. Effects unlike anything caught before score more.</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={p.words[0] ?? "name"} maxLength={24} className="min-w-0 flex-1 sm:max-w-72" aria-label="name" />
                <Button size="lg" disabled={busy || (!!me && me.catchesLeft <= 0)}>
                  Catch
                </Button>
              </div>
              {me && <div className="mt-2 text-sm text-dim">{me.catchesLeft} catches left today</div>}
              <div className="mt-2"><ErrorLine error={error} /></div>
            </form>
          )}
          {caught && (
            <div className="pop">
              <div className="text-2xl font-semibold text-good">Caught. +{caught.points} pts</div>
              <div className="text-sm text-dim">Uniqueness {caught.uniqueness.toFixed(2)}</div>
            </div>
          )}

          <div>
            <Label className="mb-4">The model's answers with this neuron pushed</Label>
            <Replies prompts={overview?.prompts ?? []} steered={p.texts} baseline={overview?.baseline} />
          </div>
        </>
      )}
    </div>
  );
}

type Card = FunctionReturnType<typeof api.neurons.card>;

// What pushing it does, how focused that is and which zone of the map it sits in, with the player's prediction if they
// made one.
function Effects({ card, effect }: { card: Card; effect: Effect }) {
  const place = card.place;
  const zone = place ? ZONES.find((z) => z.id === place.zone) : null;
  return (
    <section className="space-y-5">
      {card.prediction && (
        <p className="pop font-medium">
          {card.prediction.right
            ? `You called it: ${EFFECT_TEXT[card.prediction.said].name.toLowerCase()}. +${PREDICT_POINTS} pts`
            : `You said ${EFFECT_TEXT[card.prediction.said].name.toLowerCase()}.`}
        </p>
      )}
      <div>
        <Label>What pushing it does</Label>
        <div className="mt-1 text-2xl font-semibold">{EFFECT_TEXT[effect].name}</div>
        <div className="text-dim">{EFFECT_TEXT[effect].looks}</div>
      </div>
      {card.focus && effect !== "breaks" && (
        <div>
          <Label>Focus</Label>
          <div className="mt-1">
            {card.focus.word ? (
              <>
                <span className="font-mono font-semibold">{card.focus.word}</span> comes up in{" "}
                <span className="font-semibold">
                  {card.focus.n} of {card.focus.of}
                </span>{" "}
                replies. {card.focus.n === 4 ? "Same theme whatever the question." : card.focus.n <= 1 ? "What it brings up depends on the question." : ""}
              </>
            ) : (
              "No word repeats across its replies: what it brings up depends on the question."
            )}
          </div>
        </div>
      )}
      {zone && (
        <div>
          <Label>Zone</Label>
          <div className="mt-1">
            <Link to="/map" className={`font-semibold ${textLink}`}>
              {zone.name}
            </Link>{" "}
            <span className="text-dim">{zone.blurb}</span>
          </div>
        </div>
      )}
    </section>
  );
}
