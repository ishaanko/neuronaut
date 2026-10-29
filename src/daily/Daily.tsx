import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { isDate, REPLY_TOKENS } from "../../convex/rules";
import { HowToPlay } from "../learn/HowToPlay";
import { useUnlock } from "../learn/fieldNotes";
import { LensSearch } from "../neuron/LensSearch";
import { NeuronInput, NeuronLink } from "../neuron/parts";
import { Reply } from "../neuron/Replies";
import { useSession } from "../players/session";
import { errorText } from "../ui/errors";
import { Modal } from "../ui/Modal";
import { useNow } from "../ui/now";
import { Panel, Plate } from "../ui/Plate";
import { Button, ErrorLine, Label } from "../ui/primitives";
import { clock } from "../ui/time";
import { Archive } from "./Archive";
import { GuessList, GuessMap } from "./Guesses";
import { ChartLegend, HeatChart } from "./HeatChart";
import { ResultCard } from "./ResultCard";
import { WhyHeat } from "./WhyHeat";

const SLOW_MS = 10_000; // a guess normally scores in about a second; past this, check whether the worker is up
const OFFLINE_MS = 3 * 60_000; // the worker checks in every minute (worker:heartbeat)

// /daily is today's puzzle; /daily/<date> replays a past one for practice.
export function Daily() {
  const { date } = useParams();
  if (date !== undefined && !isDate(date)) return <p className="py-20 text-center text-dim">No such puzzle.</p>;
  return <Puzzle date={date} />;
}

function Puzzle({ date }: { date?: string }) {
  const { me, signedIn, settled, guest, requirePlay, signUp } = useSession();
  const d = useQuery(api.daily.current, { ...(date ? { date } : {}), guest });
  const tally = useQuery(api.daily.tally, d ? { date: d.date } : "skip");
  const guess = useMutation(api.daily.guess);
  const openPuzzle = useMutation(api.daily.open);
  const [layer, setLayer] = useState("");
  const [n, setN] = useState("");
  // a draft typed for one puzzle's clues doesn't carry over when the page turns over to the next one
  const [draftFor, setDraftFor] = useState(d?.date);
  if (d && d.date !== draftFor) {
    setDraftFor(d.date);
    if (draftFor !== undefined) {
      setLayer("");
      setN("");
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [showNormal, setShowNormal] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [example, setExample] = useState(false);

  useUnlock("heat", !!d?.guesses.some((g) => g.status === "done"));

  const result = d?.result ?? null;
  const finished = !!result;
  // out of guesses but the last one is still scoring: the time is already fixed at that guess
  const lastAt = d && d.guesses.length >= d.limit ? Math.max(...d.guesses.map((g) => g.at)) : null;
  const scoring = !!d?.guesses.some((g) => g.status === "pending");
  const now = useNow((!!d?.startedAt && !finished && lastAt === null) || scoring);
  // a guess still scoring after SLOW_MS: either the GPU queue is long or the worker is down, and the heartbeat says which
  const slow = !!d?.guesses.some((g) => g.status === "pending" && now - g.at > SLOW_MS);
  const seen = useQuery(api.worker.seen, slow ? {} : "skip");
  const offline = slow && seen !== undefined && (seen === null || now - seen > OFFLINE_MS);

  // start the solve clock the first time a player or guest sees this puzzle
  const needsOpen = settled && (!!me || !signedIn) && !!d && !finished && d.startedAt === null;
  const shown = d?.date;
  useEffect(() => {
    if (needsOpen && shown) openPuzzle({ date: shown, guest }).catch(() => {});
  }, [needsOpen, shown, guest, openPuzzle]);

  // open the result card once, the first time a player sees this puzzle finished
  useEffect(() => {
    if (!d || !finished) return;
    const key = `neuronaut:result:${d.date}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1");
      setResultOpen(true);
    }
  }, [d, finished]);

  const submit = async () => {
    setError(null);
    const ok = await requirePlay();
    if (!ok) return;
    const fail = (msg: string) => {
      setError(msg);
      setShaking(true);
    };
    if (!d) return;
    if (layer === "" || n === "") return fail("Enter a layer and a neuron number");
    try {
      // the puzzle on screen, not whatever the server's today is: a guess made just past midnight stays on its puzzle
      await guess({ layer: Number(layer), n: Number(n), date: d.date, guest });
      setN("");
    } catch (e) {
      fail(errorText(e));
    }
  };

  // The header doesn't wait for the puzzle, so the page paints at once.
  const header = (
    <h1 className="text-4xl font-bold tracking-tight">
      {date ? "Practice" : "Daily"}
      {d && <span className="text-rust"> #{d.number}</span>}
    </h1>
  );

  if (d === undefined)
    return (
      <div className="space-y-8">
        {header}
        <p className="py-10 text-center text-dim">Loading today's neuron…</p>
      </div>
    );
  if (d === null)
    return (
      <div className="space-y-8">
        {header}
        <p className="py-10 text-center text-dim">{date ? "No puzzle that day." : "Today's neuron is still being picked. Check back in a few minutes."}</p>
      </div>
    );

  const used = d.guesses.length;

  const hint = (value: string | null, at: number) =>
    value ? <span className="pop font-mono">{value}</span> : <span className="text-dim">after {at - used} more</span>;

  return (
    <div className="space-y-12">
      <Plate
        no={String(d.number).padStart(3, "0")}
        path={[date ? "practice" : "daily", d.date, d.difficulty, d.practice && "no points"].filter(Boolean).join(" / ")}
        cells={[
          { label: "Solved", value: tally ? `${tally.solvers} of ${tally.players}` : "-" },
          { label: "Guesses", value: `${used} of ${d.limit}` },
          {
            label: "Your time",
            value: (
              <span className="font-mono tabular-nums">
                {result ? (result.seconds !== null ? clock(result.seconds) : "-") : d.startedAt ? clock(((lastAt ?? now) - d.startedAt) / 1000) : "-"}
              </span>
            ),
          },
          { label: "Layer range", value: hint(d.band && `L${d.band[0]} to L${d.band[1]}`, d.hintsAt.band) },
          { label: "A word it pushes", value: hint(d.hint, d.hintsAt.token) },
        ]}
      >
        <div className="mb-8 space-y-3">
          {header}
          <p className="text-xl italic">We turned one neuron way up while the model answered. Which one?</p>
          <p className="max-w-[68ch] text-dim">
            Read what it said, search for words that stand out, and guess. Heat (0 to 99) is how much your guess bends the
            answers the way the hidden neuron does. It doesn't track layers: a neighbor can be cold and a far layer hot. You
            have {d.limit} guesses.{" "}
            <button className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg" onClick={() => setExample(true)}>
              Watch a game
            </button>
          </p>
        </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <Label>What the model said</Label>
            <button className="font-mono text-xs text-dim underline underline-offset-4 hover:text-fg" onClick={() => setShowNormal(!showNormal)}>
              {showNormal ? "Hide normal answers" : "Compare with normal answers"}
            </button>
          </div>
          <div className="divide-y divide-line rounded-[3px] border border-line-strong bg-card">
            {d.prompts.map((p, i) => (
              <div key={i} className="p-5">
                <div className="font-semibold">{p}</div>
                <div className={`mt-2 grid gap-5 ${showNormal ? "md:grid-cols-2" : ""}`}>
                  <div>
                    {showNormal && <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-dim">With the hidden neuron</div>}
                    <Reply text={d.texts[i]} />
                  </div>
                  {showNormal && (
                    <div>
                      <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-dim">Normal</div>
                      <Reply text={d.baseline[i]} className="text-dim" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm italic text-dim">Replies stop after {REPLY_TOKENS} tokens, so most end mid-sentence.</p>
        </section>

        <aside className="space-y-8 lg:sticky lg:top-20 lg:self-start">
          {result ? (
            <Panel ascii={d.date} className="pop p-5">
              <div className="text-lg font-semibold">
                {result.solved ? `Solved in ${result.guesses}` : "Out of guesses"}
                {result.seconds !== null && <span className="font-normal text-dim">, {clock(result.seconds)}</span>}
              </div>
              <div className="mt-1 text-dim">
                It was <NeuronLink layer={result.answer.layer} n={result.answer.n} className="text-base text-fg" />
              </div>
              <Button className="mt-4 w-full" onClick={() => setResultOpen(true)}>
                See result and share
              </Button>
              {!signedIn && (
                <p className="mt-3 text-sm text-dim">
                  Playing as a guest.{" "}
                  <button className="text-fg underline underline-offset-4" onClick={signUp}>
                    Make an account
                  </button>{" "}
                  to save it.
                </p>
              )}
            </Panel>
          ) : (
            <Panel ascii={d.date} className="p-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className="flex items-baseline justify-between">
                  <Label>Your guess</Label>
                  <span className="font-mono text-sm tabular-nums text-dim">
                    {used}/{d.limit}
                  </span>
                </div>
                <div className={`mt-3 flex flex-wrap items-end gap-2 ${shaking ? "shake" : ""}`} onAnimationEnd={() => setShaking(false)}>
                  <NeuronInput layer={layer} n={n} onLayer={setLayer} onN={setN} />
                  <Button className="min-w-24 flex-1">Guess</Button>
                </div>
                <div className="mt-2 min-h-5">
                  <ErrorLine error={error} />
                </div>
                <ChartLegend className="mt-1 border-b border-line-strong pb-2" />
                <HeatChart
                  className="mt-2"
                  slots={d.limit}
                  marks={[...d.guesses].sort((a, b) => a.at - b.at).map((g) => (g.status === "done" && g.heat !== null ? { heat: g.heat, correct: g.correct } : null))}
                />
              </form>
            </Panel>
          )}

          {used > 0 && <GuessList guesses={d.guesses} offline={offline} />}

          {!finished && (
            <LensSearch
              pickLabel="Guess this"
              onPick={(l, nn) => {
                setLayer(String(l));
                setN(String(nn));
                setError(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}

          {d.guesses.some((g) => g.place) && <GuessMap d={d} />}

        </aside>
      </div>
      </Plate>

      {result && <WhyHeat d={d} answer={result.answer} />}
      <Archive current={d.date} />

      {/* a guest who signs up from the card has no result until they pick a handle */}
      <Modal open={resultOpen && !!result} onClose={() => setResultOpen(false)} label="Today's result">
        {result && <ResultCard d={d} r={result} onClose={() => setResultOpen(false)} />}
      </Modal>
      <HowToPlay open={example} onClose={() => setExample(false)} />
    </div>
  );
}
