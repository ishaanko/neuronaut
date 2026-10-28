import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { EFFECTS, type Effect, MODEL, POINTS, PREDICT_POINTS } from "../../convex/rules";
import { BehaviorMap, ZONES, zoneTint } from "../components/BehaviorMap";
import { Replies } from "../components/Replies";
import { Button, ErrorLine, Input, Label, Plate, RarityTag, Tokens } from "../components/ui";
import { EFFECT_TEXT } from "../lib/effects";
import { dexNo } from "../lib/format";
import { useUnlock } from "../lib/notes";
import { errorText, useSession } from "../lib/session";

export function Neuron() {
  const params = useParams();
  const layer = Number(params.layer);
  const n = Number(params.n);
  const valid = Number.isInteger(layer) && Number.isInteger(n) && layer >= 0 && layer < MODEL.layers && n >= 0 && n < MODEL.width;
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
    <div className="mx-auto max-w-[920px] space-y-8">
      <div className="flex items-center gap-3 font-mono text-sm text-dim">
        {prev && <Link to={`/n/${prev[0]}/${prev[1]}`} className="rounded-[3px] px-2 py-1 hover:bg-raised hover:text-fg">&larr; {dexNo(prev[0], prev[1])}</Link>}
        {next && <Link to={`/n/${next[0]}/${next[1]}`} className="ml-auto rounded-[3px] px-2 py-1 hover:bg-raised hover:text-fg">{dexNo(next[0], next[1])} &rarr;</Link>}
      </div>

      <Plate
        no={dexNo(layer, n)}
        path={`layer ${layer} of ${MODEL.layers - 1} / neuron ${n}`}
        cells={
          p
            ? [
                { label: "Strength", value: <span className="font-mono">{p.z.toFixed(1)} <span className="text-sm text-dim">vs random</span></span> },
                { label: "Coherence", value: <span className="font-mono">{p.nll.toFixed(2)} <span className="text-sm text-dim">lower is cleaner</span></span> },
                { label: "Variety", value: <span className="font-mono">{p.distinct.toFixed(2)} <span className="text-sm text-dim">1 = no loops</span></span> },
                { label: "Worth", value: <span className="font-mono">{POINTS[p.rarity]} pts <span className="text-sm text-dim">more if unique</span></span> },
              ]
            : undefined
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <h1 className="font-mono text-5xl font-medium tracking-tight">{dexNo(layer, n)}</h1>
          {card.caught && <span className="text-3xl font-bold text-rust">{card.caught.name}</span>}
          {p && <RarityTag rarity={p.rarity} className="text-sm" />}
        </div>
        <div className="mt-2 text-dim">
          Layer {layer}, neuron {n}
          {card.caught && (
            <>
              {" "}· caught by{" "}
              <Link to={`/t/${card.caught.handle}`} className="font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                {card.caught.handle}
              </Link>{" "}
              for {card.caught.points} pts
            </>
          )}
        </div>
        <div className="mt-6 grid gap-5 border-t border-line-strong pt-5 md:grid-cols-2">
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
        </div>
      </Plate>

      {card.status === "hidden" && (
        <div className="rounded-[3px] border border-line-strong p-6">
          <h2 className="text-xl font-semibold">What will pushing it do?</h2>
          <p className="mt-1 text-dim">
            Guess from its layer ({layer} of {MODEL.layers - 1}) and the two lenses above. Picking one spends a scan and runs the
            model. A right guess is worth {PREDICT_POINTS} points.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {EFFECTS.map((e) => (
              <button
                key={e}
                onClick={() => doScan(e)}
                disabled={!!me && me.scansLeft <= 0}
                className="press rounded-[3px] border border-line-strong p-4 text-left hover:border-fg hover:bg-raised disabled:pointer-events-none disabled:opacity-40"
              >
                <div className="font-medium">{EFFECT_TEXT[e].name}</div>
                <div className="text-sm text-dim">{EFFECT_TEXT[e].looks}</div>
              </button>
            ))}
          </div>
          {me && <div className="mt-3 text-sm text-dim">{me.scansLeft} scans left today</div>}
          <div className="mt-2"><ErrorLine error={error} /></div>
        </div>
      )}

      {effect && <Effects card={card} />}

      {card.status === "pending" && (
        <p className="rounded-[3px] border border-line p-6 text-center text-lg text-dim">Running the model with it pushed. Usually a few seconds.</p>
      )}

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
              className="rounded-[3px] border border-fg p-6"
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
            <div className="pop rounded-[3px] border border-good p-6">
              <div className="text-2xl font-semibold text-good">
                Caught. +{caught.points} pts
              </div>
              <div className="text-sm text-dim">Uniqueness {caught.uniqueness.toFixed(2)}</div>
            </div>
          )}

          <div>
            <Label className="mb-3">The model's answers with this neuron pushed</Label>
            <Replies prompts={overview?.prompts ?? []} steered={p.texts} baseline={overview?.baseline} />
          </div>
        </>
      )}
    </div>
  );
}

type Card = NonNullable<(typeof api.neurons.card)["_returnType"]>;

// What pushing it does, how focused that is and where it sits on the map, with the player's prediction if they made one.
function Effects({ card }: { card: Card }) {
  const effect = card.effect!;
  const zone = card.place ? ZONES.find((z) => z.id === card.place!.zone) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-5 rounded-[3px] border border-line bg-card p-6">
        {card.prediction && (
          <div className={`pop rounded-[3px] px-4 py-3 font-medium ${card.prediction.right ? "bg-good/15 text-fg" : "bg-raised"}`}>
            {card.prediction.right
              ? `You called it: ${EFFECT_TEXT[card.prediction.said].name.toLowerCase()}. +${PREDICT_POINTS} pts`
              : `You said ${EFFECT_TEXT[card.prediction.said].name.toLowerCase()}.`}
          </div>
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
            <div className="mt-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: zoneTint(zone.id) }} />
              <span className="font-semibold">{zone.name}</span>
            </div>
            <div className="text-dim">{zone.blurb}</div>
          </div>
        )}
      </div>
      {card.place && (
        <Link to="/map" className="block rounded-[3px] border border-line bg-card p-3 hover:border-line-strong" aria-label="Open the map">
          <BehaviorMap labels={false} dots={[{ layer: card.layer, n: card.n, x: card.place.x, y: card.place.y, color: "--color-fg", size: 5 }]} />
        </Link>
      )}
    </div>
  );
}
