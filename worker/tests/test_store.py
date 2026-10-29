"""The sweep store: the only copy of the full sweep, and what daily ranks are computed from. If it loses data on a
restart (the worker restarts often) the sweep silently redoes hours of GPU work; if its ladder is off, every daily
guess gets the wrong rank and heat."""
import numpy as np
import pytest

from store import LADDER_EXACT, Store

L, N, D = 3, 700, 16  # small model shape; 2100 neurons is enough to pass LADDER_EXACT


def card(layer, n, rng, **kw):
    e = rng.standard_normal(D)
    return {"layer": layer, "n": n, "texts": [f"text {layer}:{n}"], "words": ["w"], "z": 1.0, "nll": 2.0,
            "distinct": 0.9, "embedding": (e / np.linalg.norm(e)).tolist(), **kw}


@pytest.fixture
def rng():
    return np.random.default_rng(0)


def test_roundtrip(tmp_path, rng):
    s = Store(tmp_path, L, N, D)
    c = card(1, 5, rng)
    s.put([c])
    got = s.get(1, 5)
    assert {k: got[k] for k in ("layer", "n", "texts", "words", "z", "nll", "distinct")} == \
           {k: c[k] for k in ("layer", "n", "texts", "words", "z", "nll", "distinct")}
    assert np.allclose(got["embedding"], c["embedding"], atol=1e-3)  # stored as float16


def test_unmeasured_is_none(tmp_path):
    assert Store(tmp_path, L, N, D).get(0, 0) is None


def test_survives_reopening(tmp_path, rng):
    Store(tmp_path, L, N, D).put([card(2, 9, rng), card(0, 1, rng)])
    s = Store(tmp_path, L, N, D)
    assert s.count() == 2 and s.get(2, 9)["texts"] == ["text 2:9"]


def test_remeasure_replaces(tmp_path, rng):
    s = Store(tmp_path, L, N, D)
    s.put([card(1, 1, rng, z=1.0)])
    s.put([card(1, 1, rng, z=9.0)])
    assert s.get(1, 1)["z"] == 9.0 and s.count() == 1
    assert Store(tmp_path, L, N, D).get(1, 1)["z"] == 9.0  # last write wins after reopening too


# The dev and prod workers can run at once on the same store files, each with its own Store.

def test_card_another_worker_wrote_is_readable(tmp_path, rng):
    a, b = Store(tmp_path, L, N, D), Store(tmp_path, L, N, D)
    a.put([card(1, 2, rng)])
    assert b.get(1, 2)["texts"] == ["text 1:2"]


def test_interleaved_writes_keep_cards_apart(tmp_path, rng):
    a, b = Store(tmp_path, L, N, D), Store(tmp_path, L, N, D)
    a.put([card(0, 1, rng)])
    b.put([card(0, 2, rng)])  # b's file position is stale: a appended after b opened
    a.put([card(0, 3, rng)])
    for s in (a, b):
        assert [s.get(0, n)["texts"] for n in (1, 2, 3)] == [["text 0:1"], ["text 0:2"], ["text 0:3"]]


def test_card_another_worker_rewrote_is_not_stale(tmp_path, rng):
    a, b = Store(tmp_path, L, N, D), Store(tmp_path, L, N, D)
    a.put([card(2, 4, rng, z=1.0)])
    b.put([card(2, 4, rng, z=9.0)])  # both measured it at once; b's embedding is now the shared one
    assert a.get(2, 4)["z"] == 9.0


def test_ladder_matches_brute_force(tmp_path, rng):
    s = Store(tmp_path, L, N, D)
    cards = [card(l, n, rng) for l in range(L) for n in range(N)]
    s.put(cards)
    answer = cards[37]
    ranks, cos = s.ladder(answer["embedding"], exclude=(answer["layer"], answer["n"]))
    E = np.array([c["embedding"] for c in cards if (c["layer"], c["n"]) != (answer["layer"], answer["n"])], np.float16)
    truth = np.sort(E.astype(np.float32) @ np.float32(answer["embedding"]))[::-1]
    assert ranks[:LADDER_EXACT] == list(range(1, LADDER_EXACT + 1))
    assert np.allclose(cos[:LADDER_EXACT], truth[:LADDER_EXACT], atol=2e-3)
    assert ranks[-1] == len(truth)  # the answer itself is not counted
    assert all(a < b for a, b in zip(ranks, ranks[1:])) and all(a >= b for a, b in zip(cos, cos[1:]))
    assert np.isclose(cos[-1], truth[-1], atol=2e-3)


def test_ladder_with_few_measured(tmp_path, rng):
    s = Store(tmp_path, L, N, D)
    s.put([card(0, n, rng) for n in range(5)])
    ranks, cos = s.ladder(card(1, 0, rng)["embedding"])
    assert ranks == [1, 2, 3, 4, 5] and len(cos) == 5
