import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { LADDER_EXACT } from "../../convex/rules";
import { BehaviorMap, type Dot } from "../components/BehaviorMap";
import { HowToPlay } from "../components/HowToPlay";
import { LensSearch } from "../components/LensSearch";
import { Replies, Reply, REPLY_TOKENS } from "../components/Replies";
import { ChartLegend, HeatChart } from "../components/HeatChart";
import { Button, ErrorLine, HeatBar, Label, Modal, NeuronInput, NeuronLink, Panel, Plate } from "../components/ui";
import { clock, dexNo, heatEmoji, heatVar, rankText } from "../lib/format";
import { useUnlock } from "../lib/notes";
import { useNow } from "../lib/now";
import { errorText, useSession } from "../lib/session";

type Daily = NonNullable<(typeof api.daily.current)["_returnType"]>;

function shareText(d: Daily) {
  const r = d.result!;
  const sq = r.heats.map((h, i) => heatEmoji(h, r.solved && i === r.heats.length - 1)).join("");
  const time = r.seconds === null ? "" : ` in ${clock(r.seconds)}`;
  return `Neuronaut #${d.number}${r.practice ? " (practice)" : ""} ${r.solved ? r.guesses : "X"}/${d.limit}${time}\n${sq}\n${location.origin}/daily`;
}

const SLOW_MS = 10_000; // a guess normally scores in about a second; past this, check whether the worker is up
const OFFLINE_MS = 3 * 60_000; // the worker checks in every minute (worker:heartbeat)

// Time until the next puzzle (00:00 UTC).
function untilNext(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return clock((next.getTime() - now) / 1000);
}

function ResultCard({ d, onClose }: { d: Daily; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const now = useNow(true);
  const { me, signedIn, signUp } = useSession();
  const tally = useQuery(api.daily.tally, { date: d.date });
  const r = d.result!;
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-dim">
        {d.practice ? "Practice" : "Daily"} Nº {d.number}
      </div>
      <div className={`pop mt-1 text-4xl font-bold tracking-tight ${r.solved ? "text-rust" : "text-fg"}`}>{r.solved ? "Solved." : "Out of guesses."}</div>
      <p className="mt-1 text-lg">
        {r.solved ? `Solved in ${r.guesses} ${r.guesses === 1 ? "guess" : "guesses"}` : "The neuron got away."}
        {r.seconds !== null && <span className="text-dim">, {clock(r.seconds)}</span>}
      </p>
      <div className="mt-1 text-dim">
        It was <NeuronLink layer={d.answer!.layer} n={d.answer!.n} className="text-base text-fg" />
      </div>
      <HeatChart className="mt-5" slots={d.limit} marks={r.heats.map((h, i) => ({ heat: h, correct: r.solved && i === r.heats.length - 1 }))} />
      <dl className="mt-4 grid grid-cols-3 gap-4 border-y border-fg py-4">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">{d.practice ? "Solved that day" : "Solved today"}</dt>
          <dd className="font-mono text-2xl tabular-nums">{tally?.solvers ?? "-"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">Your streak</dt>
          <dd className="font-mono text-2xl tabular-nums">{d.practice || !signedIn ? "-" : (me?.streak ?? 0)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">Next neuron</dt>
          <dd className="font-mono text-2xl tabular-nums">{untilNext(now)}</dd>
        </div>
      </dl>
      {!signedIn && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-dim">Make an account to keep this result, start a streak and get on the leaderboard.</p>
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              onClose();
              signUp();
            }}
          >
            Make an account
          </Button>
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(shareText(d));
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Share"}
        </Button>
        <Button size="lg" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

// After a puzzle: the answer's replies next to one guess's replies on the same profile prompts, so a player can see
// what heat measured. Both cards are visible by then (the player guessed one, and finishing reveals the answer).
function WhyHeat({ d, pick, onPick }: { d: Daily; pick: string | null; onPick: (k: string) => void }) {
  const wrong = d.guesses.filter((g) => !g.correct && g.status === "done");
  const g = wrong.find((x) => `${x.layer}:${x.n}` === pick) ?? wrong[0];
  const { guest } = useSession();
  const overview = useQuery(api.neurons.overview);
  const answer = useQuery(api.neurons.card, { layer: d.answer!.layer, n: d.answer!.n, guest });
  const guessed = useQuery(api.neurons.card, g ? { layer: g.layer, n: g.n, guest } : "skip");
  if (!g) return null;
  return (
    <section>
      <Label>Why each guess scored what it did</Label>
      <p className="mb-4 mt-1 max-w-[62ch] text-dim">
        Heat compares what two neurons do, not their numbers. Here is the answer next to one of your guesses on the same four
        questions. The more alike they read, the higher the cosine between their behavior embeddings.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {wrong.map((x) => {
          const k = `${x.layer}:${x.n}`;
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              className={`press rounded-[3px] px-3 py-1.5 font-mono text-sm ${x === g ? "bg-accent text-accent-fg" : "border border-line-strong hover:bg-raised"}`}
            >
              {dexNo(x.layer, x.n)} · {x.cos?.toFixed(2)}
            </button>
          );
        })}
      </div>
      {answer?.profile && guessed?.profile ? (
        <Replies
          prompts={overview?.prompts ?? []}
          steered={answer.profile.texts}
          steeredLabel={`The answer, ${dexNo(d.answer!.layer, d.answer!.n)}`}
          baseline={guessed.profile.texts}
          baselineLabel={`Your guess ${dexNo(g.layer, g.n)}: cosine ${g.cos?.toFixed(2)}, heat ${g.heat}`}
        />
      ) : (
        <p className="text-dim">Loading the answer's replies…</p>
      )}
    </section>
  );
}

// The player's guesses on the behavior map, colored by heat; the answer as a green ring once the puzzle is over.
// Quiet guesses (no place) don't show.
function GuessMap({ d }: { d: Daily }) {
  const dots: Dot[] = d.guesses.flatMap((g) => (g.place ? [{ layer: g.layer, n: g.n, ...g.place, color: heatVar(g.heat, g.correct), label: g.heat === null ? "" : `heat ${g.heat}` }] : []));
  if (d.answer?.place) dots.push({ layer: d.answer.layer, n: d.answer.n, ...d.answer.place, color: "--color-good", ring: true, size: 7, label: "the answer" });
  return (
    <div>
      <Label className="mb-2">Your guesses on the map</Label>
      <div className="rounded-[3px] border border-line bg-card p-3">
        <BehaviorMap dots={dots} labels={false} tint={false} />
      </div>
      <p className="mt-2 text-sm text-dim">Dots use the heat colors. Neurons that act alike sit close together, so hot guesses bunch up. The map squashes a lot, so trust heat over distance.</p>
    </div>
  );
}

// Past puzzles to replay for practice, newest first.
function Archive({ current }: { current: string }) {
  const { guest } = useSession();
  const past = useQuery(api.daily.archive, { guest });
  if (!past?.length) return null;
  return (
    <section>
      <Label>Past puzzles</Label>
      <p className="mb-3 mt-1 text-dim">Practice on these. Same scoring, but no points and no streak. Mondays are easiest, weekends hardest.</p>
      <div className="divide-y divide-line border-y border-line">
        {past.map((p) => (
          <Link key={p.date} to={`/daily/${p.date}`} className={`flex items-center gap-4 py-3 hover:bg-card ${p.date === current ? "bg-card" : ""}`}>
            <span className="w-12 font-mono">#{p.number}</span>
            <span className="w-20 text-sm text-dim">{p.difficulty ?? ""}</span>
            <span className="ml-auto text-sm text-dim">
              {p.mine ? (p.mine.solved ? `you solved it in ${p.mine.guesses}` : "you missed it") : p.players ? `${p.solvers} of ${p.players} solved` : "nobody played"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function Daily() {
  const { me, signedIn, settled, guest, requirePlay, signUp } = useSession();
  const { date } = useParams();
  const d = useQuery(api.daily.current, { ...(date ? { date } : {}), guest });
  const tally = useQuery(api.daily.tally, d ? { date: d.date } : "skip");
  const guess = useMutation(api.daily.guess);
  const openPuzzle = useMutation(api.daily.open);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [layer, setLayer] = useState("");
  const [n, setN] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [showNormal, setShowNormal] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [example, setExample] = useState(false);

  useUnlock("heat", !!d?.guesses.some((g) => g.status === "done"));

  const finished = !!d?.result;
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
        <p className="py-10 text-center text-dim">Today's neuron is still being picked. Check back in a few minutes.</p>
      </div>
    );

  const used = d.guesses.length;
  const latest = [...d.guesses].sort((a, b) => b.at - a.at)[0];

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
                {d.result ? (d.result.seconds !== null ? clock(d.result.seconds) : "-") : d.startedAt ? clock(((lastAt ?? now) - d.startedAt) / 1000) : "-"}
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
          {finished ? (
            <Panel ascii={d.date} className="pop p-5">
              <div className="text-lg font-semibold">
                {d.result!.solved ? `Solved in ${d.result!.guesses}` : "Out of guesses"}
                {d.result!.seconds !== null && <span className="font-normal text-dim">, {clock(d.result!.seconds)}</span>}
              </div>
              <div className="mt-1 text-dim">
                It was <NeuronLink layer={d.answer!.layer} n={d.answer!.n} className="text-base text-fg" />
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

          {used > 0 && (
            <div>
              <Label className="mb-2">Guesses, hottest first</Label>
              <div className="divide-y divide-line border-y border-fg" aria-live="polite">
                {d.guesses.map((g) => {
                  const k = `${g.layer}:${g.n}`;
                  return (
                    <div key={k} data-guess className={g === latest ? "bg-card" : ""}>
                      <button
                        type="button"
                        onClick={() => setOpen(open === k ? null : k)}
                        aria-expanded={open === k}
                        className="grid w-full grid-cols-[4.75rem_1fr_2rem_3.5rem] items-center gap-2 px-2 py-2.5 text-left hover:bg-card sm:gap-3"
                      >
                        <span className="font-mono text-sm">{dexNo(g.layer, g.n)}</span>
                        {g.status === "pending" ? (
                          <span className="text-sm text-faint">{offline ? "worker offline, scores when it's back" : "measuring…"}</span>
                        ) : (
                          <HeatBar heat={g.heat} correct={g.correct} />
                        )}
                        <span className="text-right font-mono font-medium tabular-nums">{g.status === "pending" ? "" : g.correct ? "hit" : g.heat}</span>
                        <span className="text-right font-mono text-sm tabular-nums text-dim">
                          {g.status === "pending" || g.rank === null || g.correct ? "" : rankText(g.rank)}
                        </span>
                      </button>
                      {open === k && g.status === "done" && (
                        <div className="px-2 pb-3 text-sm text-dim">
                          {g.correct ? (
                            "Its effect matches the answer's."
                          ) : (
                            <>
                              Cosine <span className="font-mono text-fg">{g.cos?.toFixed(3) ?? "?"}</span> to the answer.{" "}
                              {g.rank !== null && `${g.rank > LADDER_EXACT ? "About " : ""}${(g.rank - 1).toLocaleString()} neurons act more like it.`}{" "}
                            </>
                          )}
                          <NeuronLink layer={g.layer} n={g.n} className="ml-1" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!finished && (
            <div>
              <Label className="mb-2">Find neurons by word</Label>
              <LensSearch
                pickLabel="Guess this"
                onPick={(l, nn) => {
                  setLayer(String(l));
                  setN(String(nn));
                  setError(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </div>
          )}

          {d.guesses.some((g) => g.place) && <GuessMap d={d} />}

        </aside>
      </div>
      </Plate>

      {finished && d.answer && <WhyHeat d={d} pick={pick} onPick={setPick} />}
      <Archive current={d.date} />

      {/* a guest who signs up from the card has no result until they pick a handle */}
      <Modal open={resultOpen && finished} onClose={() => setResultOpen(false)} label="Today's result">
        <ResultCard d={d} onClose={() => setResultOpen(false)} />
      </Modal>
      <HowToPlay open={example} onClose={() => setExample(false)} />
    </div>
  );
}
