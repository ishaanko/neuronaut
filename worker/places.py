"""Places the sweep's neurons on the behavior map: where each strong neuron sits, which zone of the map that is, what kind
of effect it has and how focused it is. Reads only the local sweep store and the neuron index.

    uv run --group analysis python places.py [--relayout]
    bunx convex import --table places --replace ../data/places.jsonl

Writes ../data/places.jsonl (one row per strong neuron, plus effect-only rows for weak ones that break the text) and ../src/map/zones.json (zone names, blurbs and the coarse
grid the map draws them from). The layout (UMAP of behavior embeddings, then 28 k-means cells) is cached in
cache/layout.npz; ZONES below names those cells, so after --relayout the cell numbers change and ZONES must be redone.

Only neurons with strength z >= QUIET_Z get a place. The rest (about 73%) barely change the output when pushed alone, so
their embedding is mostly noise and any position would be made up.
"""
import json
import os
import re
import sys

import numpy as np

from lens import norm
from text import degenerate

STORE = "cache/sweep-Qwen--Qwen3.5-4B"
LAYOUT = "cache/layout.npz"
QUIET_Z = 1.5  # rules.ts Z.uncommon
GLITCH = {"nll": 3.2, "distinct": 0.5}  # rules.ts GLITCH
GRID = 48

# Map zones as unions of layout cells, named from samples of their steered replies. Order is draw order.
ZONES = [
    ("silence", "Silence", "Layer 0 neurons that make the model say nothing at all.", [3, 20, 21, 26]),
    ("stutter", "Stutter", "Early layers. Words double up and replies cut off.", [7]),
    ("derail", "Early derails", "Early pushes that knock the model off course before it has started.", [8]),
    ("tone", "Tone and scene", "Early and middle layers nudge the style and setting, and the reply stays fluent.", [1, 6, 13, 14, 15, 25]),
    ("self", "Self-talk", "Replies turn to being an AI: a body, feelings, who made it.", [5, 16]),
    ("drift", "Mid-layer drift", "Middle layers. The story wanders off in a new direction.", [9, 10, 23]),
    ("rewrite", "Late rewrites", "Late layers swap in specific things: names, places, the company that built it.", [0, 11, 17]),
    ("words", "Word pushers", "Late layers. The neuron pushes its own words into the reply, sometimes until one takes over.", [22, 24]),
    ("phrase", "Phrase loops", "Late layers. A phrase repeats until the reply falls apart.", [4, 18, 19, 27]),
    ("loop", "Word loops", "The last layers. Pushed hard, the neuron's one word is all that is left.", [2, 12]),
]


def words_in(word, texts):
    return sum(1 for t in texts if re.search(r"\b" + re.escape(word.lower()) + r"\b", t))


def effect_and_focus(card, steer):
    """effect: "breaks" (the text falls apart), "word" (its top steer tokens show up in the replies: the logit lens
    predicted it) or "shift" (it changes the replies without its own tokens). focus: in how many of the 4 profile
    replies its most consistent distinctive word appears, and that word. None for "breaks"."""
    texts = [t.lower() for t in card["texts"]]
    if card["nll"] > GLITCH["nll"] or card["distinct"] < GLITCH["distinct"] or any(degenerate(t) for t in card["texts"]):
        return "breaks", None, None
    toks = [t for t in (norm(s) for s in steer[:3]) if t]
    effect = "word" if max([words_in(t, texts) for t in toks] or [0]) >= 2 else "shift"
    scored = [(words_in(w, texts), w) for w in card["words"][:8]]
    focus, word = max(scored, default=(0, None), key=lambda x: x[0])
    return effect, focus, word if focus else None


def layout(X, relayout):
    if os.path.exists(LAYOUT) and not relayout:
        z = np.load(LAYOUT)
        return z["xy"], z["cell"]
    import umap
    from sklearn.cluster import KMeans

    X = X + np.random.default_rng(0).normal(0, 1e-4, X.shape).astype(np.float32)  # exact duplicates break the init
    xy = umap.UMAP(n_neighbors=30, n_components=2, metric="cosine", min_dist=0.1, random_state=0, low_memory=True).fit_transform(X)
    cell = KMeans(28, n_init=4, random_state=0).fit(xy).labels_
    np.savez(LAYOUT, xy=xy, cell=cell)
    return xy, cell


def ranked(v):
    """Rank-normalizes to [0, 1]: keeps who is next to whom but spreads the dense middle and pulls far islands in, so
    the whole map is usable on a screen. Distances on the map are approximate either way."""
    r = np.empty(len(v))
    r[np.argsort(v, kind="stable")] = np.arange(len(v))
    return r / max(1, len(v) - 1)


def main():
    emb = np.load(os.path.join(STORE, "emb.npy"), mmap_mode="r")
    cards = {}
    with open(os.path.join(STORE, "cards.jsonl")) as f:
        for line in f:
            c = json.loads(line)
            cards[(c["layer"], c["n"])] = c
    keys = sorted(k for k, c in cards.items() if c["z"] >= QUIET_Z)
    steer = {}
    with open("../data/neurons.jsonl") as f:
        for line in f:
            r = json.loads(line)
            steer[(r["layer"], r["n"])] = r["steer"]

    idx = np.array(keys)
    X = np.asarray(emb[idx[:, 0], idx[:, 1]], np.float32)
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    xy, cell = layout(X, "--relayout" in sys.argv)
    zone_of = {c: z for z, (_, _, _, cells) in enumerate(ZONES) for c in cells}
    assert set(zone_of) == set(range(cell.max() + 1)), "every layout cell needs a zone"
    zone = np.array([zone_of[c] for c in cell])
    x, y = ranked(xy[:, 0]), 1 - ranked(xy[:, 1])

    gx, gy = np.minimum((x * GRID).astype(int), GRID - 1), np.minimum((y * GRID).astype(int), GRID - 1)
    rng = np.random.default_rng(0)
    placed = set(keys)
    with open("../data/places.jsonl", "w") as out:
        for i, k in enumerate(keys):
            effect, focus, word = effect_and_focus(cards[k], steer[k])
            row = {"layer": k[0], "n": k[1], "effect": effect, "zone": ZONES[zone[i]][0], "x": round(float(x[i]), 4),
                   "y": round(float(y[i]), 4), "cell": int(gy[i] * GRID + gx[i]), "r": round(float(rng.random()), 6)}
            if focus is not None:
                row |= {"focus": focus} | ({"focusWord": word} if word else {})
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
        # too weak to place, but the text still falls apart: their effect is "breaks", not "quiet"
        for k, c in cards.items():
            if k not in placed and effect_and_focus(c, steer[k])[0] == "breaks":
                out.write(json.dumps({"layer": k[0], "n": k[1], "effect": "breaks"}) + "\n")

    # Each grid square takes the zone most of its neurons are in; the map tints squares and labels each zone at its median.
    g = np.full((GRID, GRID), -1)
    counts = np.zeros((GRID, GRID, len(ZONES)), int)
    np.add.at(counts, (gy, gx, zone), 1)
    g[counts.sum(2) > 0] = counts.argmax(2)[counts.sum(2) > 0]
    zones = [{"id": zid, "name": name, "blurb": blurb, "count": int((zone == z).sum()),
              "x": round(float(np.median(x[zone == z])), 3), "y": round(float(np.median(y[zone == z])), 3)}
             for z, (zid, name, blurb, _) in enumerate(ZONES)]
    os.makedirs("../src/map", exist_ok=True)
    with open("../src/map/zones.json", "w") as f:
        json.dump({"grid": GRID, "cells": "".join("." if v < 0 else chr(97 + v) for v in g.ravel()), "zones": zones,
                   "placed": len(keys), "total": len(cards)}, f, ensure_ascii=False)
    print(f"placed {len(keys)} of {len(cards)} neurons in {len(ZONES)} zones")


if __name__ == "__main__":
    main()
