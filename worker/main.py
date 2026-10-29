"""The GPU worker: takes jobs from Convex (profiles, bounty judging, par searches, daily puzzles) and, with --sweep,
measures every neuron in the model while it has nothing else to do.

    CONVEX_URL=http://127.0.0.1:3210 WORKER_SECRET=... uv run python main.py [--sweep]

Guesses (profile jobs) have a lane of their own: a thread with its own Convex connection that answers them from the
store, so a guess never waits behind a judge or par search. Everything else runs on the GPU loop, where jobs players
wait on (priority 0) go first and the sweep only runs one batch at a time between checks for new jobs. The sweep's
results stay in a local store (store.py), not in Convex: a profile job for a neuron the sweep already measured is
answered from it with no GPU work, and daily ranks are computed against all of it.
"""
import argparse
import asyncio
import datetime
import os
import queue
import re
import threading

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")  # less fragmentation, so batches keep fitting
import random
import time
import traceback
from collections import Counter

import numpy as np
import torch
from convex import ConvexClient

from engine import PROFILE_DOSE, Engine, degenerate, distinct2, words
from lens import Lens, norm
from store import Store

MODEL = os.environ.get("GAME_MODEL", "Qwen/Qwen3.5-4B")
RARE_Z, QUIET_Z, GLITCH_NLL, GLITCH_DISTINCT = 3.5, 1.5, 3.2, 0.5  # mirrors convex/rules.ts
DISPLAY_PROMPTS = [  # daily puzzle prompts: never the profile prompts, so a card's text can't be matched verbatim
    "What do you think about on a rainy afternoon?",
    "Write a short note to a friend.",
    "Explain how to make a cup of tea.",
    "What is the most interesting thing you know?",
    "Describe the view from a window.",
    "Give me three tips for a long trip.",
    "What would you name a new pet?",
    "Tell me about an old photograph.",
    "What makes a good morning?",
    "Describe a sound you like.",
]
PAR_DOSES = [0.4, 0.7, 1.0]
# Dailies get harder through the week, like a newspaper crossword. Easy: late layers, and the neuron's own steer-lens
# words show up in its replies (so lens search finds it). Hard: early or middle layers, and they don't.
DIFFICULTY = ["easy", "easy", "medium", "medium", "hard", "hard", "hard"]  # Monday first
BANDS = {"easy": [(19, 25), (26, 30)], "medium": [(11, 18), (19, 25)], "hard": [(3, 10), (11, 18)]}
LADDER_EVERY = 600  # sweep batches (~1.5 h) between refreshes of upcoming dailies' ladders
GPU_KINDS = ["judge", "daily", "par", "combo"]  # the GPU loop's jobs; profile jobs go to the profile lane
WAKE_S = 300  # an idle lane claims again this often, to pick up its jobs a restart left running (STALE_MS in worker.ts)
HEARTBEAT_S = 60  # how often the worker checks in (worker:heartbeat), so a hanging guess can say the worker is down
STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", f"sweep-{MODEL.replace('/', '--')}")


def neuron(job):
    return int(job["args"]["layer"]), int(job["args"]["n"])


def as_profile(p):
    return {k: p[k] for k in ("layer", "n", "texts", "words", "z", "nll", "distinct", "embedding")}


class Worker:
    def __init__(self, url, secret):
        self.url, self.secret = url, secret
        self.local = threading.local()
        self.gpu = threading.Lock()
        self.misses = queue.Queue()  # profile jobs for neurons not in the store yet (measure_misses)
        self.eng = Engine(MODEL)
        self.lens = Lens()
        self.store = Store(STORE, *self.lens.kl.shape)

    @property
    def c(self):
        """This thread's Convex connection: each lane blocks on its own subscription."""
        if not hasattr(self.local, "c"):
            self.local.c = ConvexClient(self.url)
        return self.local.c

    def reconnect(self):
        # a client whose connection died ("channel closed") hangs on every later call, so start a fresh one; its first
        # call waits until the backend is back
        self.local.c = ConvexClient(self.url)

    def call(self, kind, name, **args):
        return getattr(self.c, kind)(name, {"secret": self.secret, **args})

    # ---------- jobs ----------
    def run(self, jobs):
        """Runs claimed GPU jobs one at a time: judging first, then par searches, dailies and lab experiments."""
        for kind, handle in (("judge", self.judge), ("par", self.par), ("daily", self.daily), ("combo", self.combo)):
            for j in jobs:
                if j["kind"] == kind:
                    self.guard([j], lambda js: handle(js[0]))

    def guard(self, jobs, fn):
        try:
            fn(jobs)
        except Exception as e:
            traceback.print_exc()
            for j in jobs:
                self.call("mutation", "worker:fail", id=j["id"], error=f"{type(e).__name__}: {e}")

    def profiles(self, jobs):
        """Answers neurons the sweep measured straight from the store. The rest go to measure_misses, so they never hold
        up the next guess."""
        known = [j for j in jobs if self.store.has(*neuron(j))]
        for j in jobs:
            if j not in known:
                self.misses.put(j)
        if known:
            t = time.time()
            self.call("mutation", "worker:putProfiles", jobIds=[j["id"] for j in known],
                      profiles=[as_profile(self.store.get(*neuron(j))) for j in known])
            print(f"profiled {len(known)} from the store in {time.time() - t:.1f}s", flush=True)

    def measure_misses(self):
        """Measures guessed neurons the sweep hasn't reached yet, on a thread of their own, once the GPU is free."""
        while True:
            jobs = [self.misses.get()]
            while not self.misses.empty():
                jobs.append(self.misses.get())
            try:
                self.guard(jobs, self.measure)
            except Exception:  # Convex unreachable even for worker:fail
                traceback.print_exc()
                self.reconnect()

    def measure(self, jobs):
        t = time.time()
        with self.gpu:
            fresh = self.eng.profile([neuron(j) for j in jobs])
        self.store.put(fresh)
        self.call("mutation", "worker:putProfiles", jobIds=[j["id"] for j in jobs], profiles=[as_profile(p) for p in fresh])
        print(f"profiled {len(fresh)} on the GPU in {time.time() - t:.1f}s", flush=True)

    def combo(self, job):
        """A lab experiment: two pushes alone and together while the model reads the same normal replies (Engine.forced),
        so any difference between the joint effect and the sum of the separate ones comes from the layers after the
        pushes, not from decoding going a different way. additivity: cosine of the joint change with the sum (1 = they
        just add up). gain: the joint change's size over the sum's. towardA/B: its cosine with each alone. faint: one
        of them is quiet on its card, so the pair trivially looks like the other. texts: replies with both pushed."""
        a = job["args"]
        (la, na, da), (lb, nb, db) = [(int(p["layer"]), int(p["n"]), float(p["dose"])) for p in (a["a"], a["b"])]
        pa, pb = self.eng.push(la, na, da), self.eng.push(lb, nb, db)
        ea, eb, eab = self.eng.forced([[pa], [pb], [pa, pb]])
        cos = lambda x, y: round(float(torch.nn.functional.cosine_similarity(x, y, dim=0)), 3)
        total = ea + eb
        cards = [self.store.get(la, na), self.store.get(lb, nb)]
        faint = any(c is None or c["z"] < QUIET_Z for c in cards)
        texts = self.eng.measure([[pa, pb]])[0]["texts"]
        self.call("mutation", "worker:finishCombo", id=job["id"], experimentId=a["experimentId"], texts=texts,
                  additivity=cos(eab, total), gain=round(float(eab.norm() / total.norm().clamp(min=1e-6)), 3),
                  towardA=cos(eab, ea), towardB=cos(eab, eb), faint=faint)
        print(f"combo L{la}N{na} + L{lb}N{nb}: additivity {cos(eab, total)}", flush=True)

    def judge(self, job):
        a = job["args"]
        entry = [(int(p["layer"]), int(p["n"]), float(p["dose"])) for p in a["pushes"]]
        r, = self.eng.judge([entry], a["prompts"], a["anchors"], a.get("question"))
        self.call("mutation", "worker:finishJudge", id=job["id"], entryId=a["entryId"], **r)
        print(f"judged {a['slug']} {entry}: {r['score']}", flush=True)

    def par(self, job):
        """The house attempt at a bounty: neurons whose steer lens matches the anchors' words, each tried at a few doses
        on its own. The best score is par."""
        a = job["args"]
        ws = [w for w, _ in Counter(w for t in a["anchors"] for w in words(t) if w not in self.eng.generic).most_common(30)]
        cands = self.lens.candidates(ws, k=64)
        entries = [[(l, n, d)] for l, n in cands for d in PAR_DOSES]
        best = (0.0, None)
        for s in range(0, len(entries), 48):
            chunk = entries[s:s + 48]
            for e, r in zip(chunk, self.eng.judge(chunk, a["prompts"], a["anchors"], a.get("question"))):
                if r["score"] > best[0]:
                    best = (r["score"], e)
        pushes = [{"layer": l, "n": n, "dose": d} for l, n, d in best[1]] if best[1] else []
        self.call("mutation", "worker:putPar", id=job["id"], slug=a["slug"], score=best[0], pushes=pushes)
        print(f"par {a['slug']}: {best}", flush=True)

    def daily(self, job):
        """Picks a hidden neuron for a date: strong (rare or better), coherent, with distinctive words a player can
        find through lens search, and no near-twin anywhere in the sweep (so one answer). Candidates come from the
        sweep store; while it's thin in the date's layer band, 64 more are measured on the GPU."""
        a = job["args"]
        rng = random.Random(a["date"])
        exclude = set(a.get("exclude", []))
        level = DIFFICULTY[datetime.date.fromisoformat(a["date"]).weekday()]
        # each date draws a depth band for its difficulty, then the strongest 10% (steer KL) within it
        lo, hi = rng.choice(BANDS[level])
        band = self.lens.kl[lo:hi + 1]
        strong = [tuple(map(int, x)) for x in np.argwhere(band >= np.quantile(band, 0.9)) + [lo, 0]]
        strong = [(l, n) for l, n in strong if f"{l}:{n}" not in exclude]
        rng.shuffle(strong)
        measured = [self.store.get(l, n) for l, n in strong if self.store.has(l, n)]
        for attempt in range(6):
            if attempt or len([p for p in measured if self.suits(p)]) < 8:
                pick = [k for k in strong if not self.store.has(*k)][:64]
                fresh = self.eng.profile(pick)
                self.store.put(fresh)
                measured += fresh
            good = [p for p in measured if self.suits(p) and (level == "medium" or self.own_words(p) == (level == "easy"))]
            rng.shuffle(good)
            for p in good:
                measured.remove(p)  # tried once, whatever happens
                if not self.findable(p):
                    continue
                ranks, cos = self.store.ladder(p["embedding"], exclude=(p["layer"], p["n"]))
                if (cos[0] if cos else 0) < 0.9 and self.publish(job, a["date"], p, rng, level):
                    return
            print(f"daily {a['date']}: attempt {attempt} found no puzzle among {len(good)} candidates", flush=True)
        raise RuntimeError("no suitable neuron found")

    def suits(self, p):
        """Strong, coherent and with words to search for. Findability is checked separately, only for the neuron about
        to be published: it scans every neuron's steer lens."""
        return p["z"] >= RARE_Z and p["nll"] <= GLITCH_NLL and p["distinct"] >= GLITCH_DISTINCT and len(p["words"]) >= 3

    def own_words(self, p):
        """Whether the neuron's top steer-lens words show up in at least 2 of its replies (worker/places.py "word")."""
        toks = [t for t in (norm(x) for x in self.lens.tokens(p["layer"], p["n"], 3)) if t]
        texts = [t.lower() for t in p["texts"]]
        return any(sum(1 for t in texts if re.search(r"\b" + re.escape(w) + r"\b", t)) >= 2 for w in toks)

    def findable(self, p):
        return any(self.lens.findable(p["layer"], p["n"], w) for w in p["words"][:6])

    def publish(self, job, date, p, rng, difficulty):
        """Writes the puzzle if the neuron's replies to the display prompts stay readable (no loops, no silence);
        returns whether it did."""
        l, n = p["layer"], p["n"]
        prompts = rng.sample(DISPLAY_PROMPTS, 3)
        texts, baseline = [], []
        for q in prompts:
            (s, ids), (b, _) = self.eng.generate(q, [[self.eng.push(l, n, PROFILE_DOSE)], []])
            if degenerate(s) or distinct2(ids) < 0.7:
                return False
            texts.append(s)
            baseline.append(b)
        lo = max(0, min(self.eng.L - 8, l - rng.randint(0, 7)))
        hint = next((t.strip() for t in self.lens.tokens(l, n, 12) if norm(t)), self.lens.tokens(l, n, 1)[0].strip())
        ranks, cos = self.store.ladder(p["embedding"], exclude=(l, n))
        self.call("mutation", "worker:putDaily", id=job["id"], date=date, layer=l, n=n, prompts=prompts, texts=texts,
                  baseline=baseline, embedding=p["embedding"], band=[lo, lo + 7], hint=hint,
                  ladder={"ranks": ranks, "cos": cos}, difficulty=difficulty)
        print(f"daily {date} ({difficulty}): L{l} N{n} {p['words'][:5]} z={p['z']:.1f}", flush=True)
        return True

    def refresh_ladders(self):
        """Recomputes upcoming dailies' ladders against the store: ranks get sharper as the sweep fills in."""
        ds = self.call("query", "worker:upcomingDailies")
        for d in ds:
            ranks, cos = self.store.ladder(d["embedding"], exclude=(int(d["layer"]), int(d["n"])))
            self.call("mutation", "worker:setLadder", id=d["id"], ladder={"ranks": ranks, "cos": cos})
        self.call("mutation", "worker:putSwept", swept=self.store.count())
        print(f"refreshed ladders of {len(ds)} dailies against {self.store.count()} measured neurons", flush=True)

    # ---------- sweep ----------
    def sweep_batch(self, state, size=64):
        """Measures the next `size` neurons of a fixed random order of the whole model into the store. Returns False
        when done. 64 rows peak at ~14.4 GiB on a 16 GB card. Past what's free, WSL spills to system RAM and decode gets
        ~9x slower per row, so don't raise it without measuring."""
        order, path = state
        cur = int(open(path).read()) if os.path.exists(path) else 0
        if cur >= len(order):
            return False
        chunk = [tuple(map(int, order[i])) for i in range(cur, min(cur + size, len(order))) if not self.store.has(*order[i])]
        t = time.time()
        with self.gpu:
            res = self.eng.profile(chunk, batch=size) if chunk else []
        self.store.put(res)
        nxt = min(cur + size, len(order))
        open(path, "w").write(str(nxt))
        gib = 2 ** 30
        print(f"sweep {nxt}/{len(order)} (+{len(res)}) {time.time() - t:.1f}s "
              f"mem {torch.cuda.max_memory_allocated() / gib:.1f}/{torch.cuda.memory_reserved() / gib:.1f}G", flush=True)
        torch.cuda.reset_peak_memory_stats()
        if nxt >= len(order) or (cur // size + 1) % LADDER_EVERY == 0:
            self.refresh_ladders()
        elif (cur // size) % 10 == 0:
            self.call("mutation", "worker:putSwept", swept=self.store.count())
        return True

    def wait(self, kinds):
        """Blocks until a job of `kinds` is pending, or WAKE_S passes. Uses the async iterator: the client's blocking one
        holds the GIL while it waits, which freezes the worker's other threads."""
        async def first():
            sub = self.c.subscribe("worker:pending", {"secret": self.secret, "kinds": kinds})
            async for count in sub:
                if count:
                    sub.unsubscribe()  # a timeout's cancellation drops the subscription itself
                    return

        try:
            asyncio.run(asyncio.wait_for(first(), WAKE_S))
        except TimeoutError:
            pass

    def loop(self, sweep):
        state = None
        if sweep:
            L, N = self.lens.kl.shape
            order = np.random.default_rng(0).permutation(np.argwhere(np.ones((L, N), bool)))
            state = (order, STORE + ".cursor")
        self.call("mutation", "worker:putBaseline", prompts=[b["prompt"] for b in self.eng.base],
                  texts=[b["text"] for b in self.eng.base])
        self.refresh_ladders()
        print("worker ready", flush=True)
        while True:
            jobs = self.call("mutation", "worker:claim", max=24, kinds=GPU_KINDS)
            if jobs:
                with self.gpu:
                    self.run(jobs)
                # judging and par searches batch wider than the sweep; give that memory back, or the sweep's next
                # batch no longer fits in VRAM and WSL spills it to system RAM (~7x slower, no error)
                torch.cuda.empty_cache()
            elif not (state and self.sweep_batch(state)):
                self.wait(GPU_KINDS)

    def profile_lane(self):
        """Answers guesses on a thread of their own: a neuron the sweep measured is a store lookup (~0.1 s)."""
        while True:
            try:
                jobs = self.call("mutation", "worker:claim", max=24, kinds=["profile"])
                if jobs:
                    self.guard(jobs, self.profiles)
                else:
                    self.wait(["profile"])
            except Exception:
                traceback.print_exc()
                time.sleep(10)
                self.reconnect()

    def heartbeat(self):
        while True:
            try:
                self.call("mutation", "worker:heartbeat")
            except Exception:
                traceback.print_exc()
                self.reconnect()
            time.sleep(HEARTBEAT_S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true", help="measure every neuron when idle")
    a = ap.parse_args()
    w = Worker(os.environ["CONVEX_URL"], os.environ["WORKER_SECRET"])
    threading.Thread(target=w.profile_lane, daemon=True).start()
    threading.Thread(target=w.measure_misses, daemon=True).start()
    threading.Thread(target=w.heartbeat, daemon=True).start()
    while True:
        try:
            w.loop(a.sweep)
        except KeyboardInterrupt:
            raise
        except Exception:  # Convex unreachable and the like: keep the model loaded and retry
            traceback.print_exc()
            time.sleep(10)
            w.reconnect()


if __name__ == "__main__":
    main()
