"""The sweep's results on local disk: one slot per neuron, so the full model's measurements never need to fit in Convex.

    s = Store("cache/sweep-Qwen--Qwen3.5-4B", layers, width)
    s.put(profiles)                    # engine.profile() output
    s.get(22, 2742)                    # card dict with its embedding, or None if not measured yet
    ranks, cos = s.ladder(embedding)   # how close every measured neuron is to this one, for daily ranks

Files: emb.npy [layers, width, dim] float16 and done.npy [layers, width] bool are memory-mapped and written in place;
cards.jsonl is append-only (one line per measurement, the last line for a neuron wins), indexed by byte offset in memory.
The dev and prod workers can share one store: appends hold a file lock, and every read first indexes whatever the other
process appended.
"""
import fcntl
import json
import os
import threading

import numpy as np

LADDER_EXACT = 1024  # the ladder keeps every cosine down to this rank; past it, one point per power of two


class Store:
    def __init__(self, root, layers, width, dim=256):
        os.makedirs(root, exist_ok=True)
        self.L, self.N, self.D = layers, width, dim
        self.emb = self._map(os.path.join(root, "emb.npy"), np.float16, (layers, width, dim))
        self.done = self._map(os.path.join(root, "done.npy"), np.bool_, (layers, width))
        self.cards_path = os.path.join(root, "cards.jsonl")
        self.cards = open(self.cards_path, "ab")
        self.offsets, self.scanned = {}, 0
        self._scan()
        self.lock = threading.Lock()  # the worker's profile lane reads while the sweep writes

    @staticmethod
    def _map(path, dtype, shape):
        if os.path.exists(path):
            return np.lib.format.open_memmap(path, mode="r+")
        return np.lib.format.open_memmap(path, mode="w+", dtype=dtype, shape=shape)

    def count(self):
        return int(self.done.sum())

    def has(self, layer, n):
        return bool(self.done[layer, n])

    def _scan(self):
        """Indexes card lines appended since the last scan, by this process or another. Stops at a line still being
        written."""
        with open(self.cards_path, "rb") as f:
            f.seek(self.scanned)
            for line in f:
                if not line.endswith(b"\n"):
                    break
                c = json.loads(line)
                self.offsets[(c["layer"], c["n"])] = self.scanned
                self.scanned += len(line)

    def put(self, profiles):
        """Writes the card lines first, then the embeddings and done flags, so neither a crash nor another process
        reading ever sees a neuron done without its card."""
        with self.lock:
            fcntl.flock(self.cards, fcntl.LOCK_EX)
            try:
                self._scan()  # the other process's appends, so offsets start at the real end of the file
                self.cards.seek(0, os.SEEK_END)
                for p in profiles:
                    l, n = int(p["layer"]), int(p["n"])
                    card = {k: p[k] for k in ("texts", "words", "z", "nll", "distinct")} | {"layer": l, "n": n}
                    self.offsets[(l, n)] = self.cards.tell()
                    self.cards.write((json.dumps(card, ensure_ascii=False) + "\n").encode())
                self.cards.flush()
                self.scanned = self.cards.tell()
            finally:
                fcntl.flock(self.cards, fcntl.LOCK_UN)
            for p in profiles:
                l, n = int(p["layer"]), int(p["n"])
                self.emb[l, n] = np.asarray(p["embedding"], np.float32)
                self.done[l, n] = True
            self.emb.flush()
            self.done.flush()

    def get(self, layer, n):
        with self.lock:
            if not self.done[layer, n]:
                return None
            self._scan()  # another worker may have written (or rewritten) it; usually reads nothing
            with open(self.cards_path, "rb") as f:
                f.seek(self.offsets[(layer, n)])
                c = json.loads(f.readline())
            return c | {"embedding": self.emb[layer, n].astype(np.float32).tolist()}

    def ladder(self, embedding, exclude=None):
        """Cosines of every measured neuron to `embedding`, sorted high to low and sampled at `ranks`: every rank up to
        LADDER_EXACT, then powers of two, then the last. `exclude` leaves out the neuron itself (a daily's answer)."""
        mask = self.done.copy()
        if exclude is not None:
            mask[exclude] = False
        cos = np.sort(self.emb[mask].astype(np.float32) @ np.asarray(embedding, np.float32))[::-1]
        M = len(cos)
        ranks = list(range(1, min(M, LADDER_EXACT) + 1))
        r = 2 * LADDER_EXACT
        while r < M:
            ranks.append(r)
            r *= 2
        if M > LADDER_EXACT:
            ranks.append(M)
        return ranks, [float(cos[r - 1]) for r in ranks]
