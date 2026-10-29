"""The GPU side of the game: steered generation and the measurements every mode scores with.

    eng = Engine("Qwen/Qwen3.5-4B")
    texts = eng.generate(prompt, [eng.push(14, 2742, 0.6)] * 2)     # one row per push list, all on the same prompt
    prof = eng.profile([(14, 2742), (3, 10)])                       # cards: texts, rarity, embedding

A push adds dose x (the layer's median residual norm) along a neuron's unit write direction at the MLP output, at every
position: the explorer's `add` steering. Rows of one generate call share a prompt, so nothing is padded on the left
(Qwen3.5's linear attention would carry padding into its state).

Embedding: the unsteered model reads prompt + response and we mean-pool the response's hidden states at EMB_LAYER,
z-scored per dimension on reference text (so the few massive-activation dimensions don't dominate). A neuron's shift is
its steered pool minus the unsteered pool, averaged over prompts, minus the mean shift random directions cause at the
same layer and dose. Cosine between shifts is how similar two neurons' effects are; the shift's size against random
directions is the neuron's strength.
"""
import hashlib
import json
import os
import re
from collections import Counter

import numpy as np
import torch
from transformers.cache_utils import LinearAttentionLayer

from spec import Spec
from text import degenerate, distinct2  # noqa: F401  (main.py imports them from here)

PROFILE_PROMPTS = ["Who are you?", "Describe your perfect day.", "Tell me a short story.", "What should I cook tonight?"]
PROFILE_DOSE = 0.6
MAX_NEW = 40
EMB_DIM = 256  # stored embeddings: a fixed random projection of the shift (cosine survives it to about +-0.06)
N_CONTROLS = 48
REFERENCE_TEXT = (
    "The history of the city goes back to a small fishing village on the river. Over the centuries it grew into a "
    "trading port, and by the nineteenth century factories lined both banks. Today most of the old warehouses are "
    "apartments and the harbour is a park. Ask anyone who lives there what they like about it and they will tell you "
    "about the food, the markets on Sunday mornings, and the long walks along the water when the weather is good."
)
STOP = set("""a an the and or but if then so to of in on at by for with from as is are was were be been being it its
this that these those i you he she we they me him her us them my your his our their mine yours what which who whom whose
when where why how not no yes do does did done have has had having can could will would shall should may might must just
very really also too there here about into over under up down out off again more most some any all each every other such
only own same than s t don't i'm it's you're i'll i've let's like get got one two well""".split())
WORD = re.compile(r"[a-zA-Z][a-zA-Z'-]{2,}")


def _assign_recurrent_state(self, recurrent_states, state_idx=0, **kwargs):
    # transformers copies each step's new linear-attention state into the cache so cudagraphs keep a fixed address. We
    # don't use cudagraphs, and at sweep batch sizes that copy (~200 MB per layer per step) is a third of decode time.
    if not self.is_recurrent_states_initialized[state_idx]:
        self.lazy_initialization(recurrent_states=recurrent_states, state_idx=state_idx)
    self.recurrent_states[state_idx] = recurrent_states
    return recurrent_states


LinearAttentionLayer.update_recurrent_state = _assign_recurrent_state


def words(text):
    return [w.lower() for w in WORD.findall(text) if w.lower() not in STOP]


class Engine:
    def __init__(self, model, device="cuda"):
        self.sp = sp = Spec.load(model, device)
        self.tok, self.dev = sp.tok, sp.device
        self.L = sp.n_layers
        self.emb_layer = (2 * self.L) // 3
        self.stop = sp.stop_ids()
        self._push = {}  # layer -> [rows, hidden] added to that layer's MLP branch output
        self._cap = None  # set to capture the EMB_LAYER residual
        for i in range(self.L):
            sp.branch(i).register_forward_hook(self._branch_hook(i))
        sp.layers[self.emb_layer].register_forward_hook(self._cap_hook)
        self._units = {}
        g = torch.Generator().manual_seed(0)
        H = sp.cfg.hidden_size
        self.proj = (torch.randn(H, EMB_DIM, generator=g) / EMB_DIM ** 0.5).to(self.dev)
        self._reference()
        self.base = self._baseline(PROFILE_PROMPTS)
        self._load_controls(model)
        self._targets = {}

    # ---------- hooks ----------
    def _branch_hook(self, i):
        def hook(mod, inp, out):
            v = self._push.get(i)
            if v is not None:
                return out + v[:, None, :].to(out.dtype)
        return hook

    def _cap_hook(self, mod, inp, out):
        if self._cap is not None:
            self._cap.append(out[0] if isinstance(out, tuple) else out)

    def _resid_all(self, ids):
        caps = {}
        hs = [self.sp.layers[i].register_forward_hook(
            lambda m, inp, out, i=i: caps.__setitem__(i, (out[0] if isinstance(out, tuple) else out)[0].float()))
              for i in range(self.L)]
        try:
            with torch.inference_mode():
                self.sp.lm(input_ids=ids, use_cache=False)
        finally:
            for h in hs:
                h.remove()
        return caps

    def _reference(self):
        """Median residual norm leaving each layer (the dose unit) and per-dimension stats at EMB_LAYER."""
        ids = self.tok(REFERENCE_TEXT, return_tensors="pt").input_ids.to(self.dev)
        caps = self._resid_all(ids)
        self.norms = [float(caps[i][1:].norm(dim=-1).median()) / self.sp.out_scale(i) for i in range(self.L)]
        h = caps[self.emb_layer][1:]
        self.mu, self.sd = h.mean(0), h.std(0).clamp(min=1e-3)

    def unit(self, layer):
        if layer not in self._units:
            W = self.sp.write_cols(layer)
            self._units[layer] = (W / W.norm(dim=0)).T.contiguous()  # [N, hidden]
        return self._units[layer]

    def push(self, layer, n, dose):
        """One push as (layer, vector): dose median residual norms along neuron n's write direction."""
        return layer, dose * self.norms[layer] * self.unit(layer)[n]

    # ---------- generation ----------
    def chat(self, prompt):
        return self.sp.chat_ids([{"role": "user", "content": prompt}])

    def generate(self, prompt, rows, max_new=MAX_NEW):
        """Greedy-decodes `prompt` once per row; rows[i] is a list of pushes (layer, vector), [] for unsteered.
        Returns per row (text, token ids)."""
        q = self.chat(prompt)
        R = len(rows)
        H = self.sp.cfg.hidden_size
        push = {}
        for r, ps in enumerate(rows):
            for layer, v in ps:
                push.setdefault(layer, torch.zeros(R, H, device=self.dev))[r] += v
        ids = torch.tensor([q] * R, device=self.dev)
        out_ids, done = [[] for _ in range(R)], [False] * R
        self._push = push
        try:
            with torch.inference_mode():
                out = self.sp.model(input_ids=ids, use_cache=True, logits_to_keep=1)
                for _ in range(max_new):
                    nxt = out.logits[:, -1].argmax(-1)
                    for r, t in enumerate(nxt.tolist()):
                        if not done[r]:
                            if t in self.stop:
                                done[r] = True
                            else:
                                out_ids[r].append(t)
                    if all(done):
                        break
                    out = self.sp.model(input_ids=nxt[:, None], past_key_values=out.past_key_values, use_cache=True,
                                        logits_to_keep=1)
        finally:
            self._push = {}
        return [(self.tok.decode(o, skip_special_tokens=True).strip(), o) for o in out_ids]

    def read(self, prompt, responses):
        """The unsteered model reads prompt + each response: the response's pooled z-scored hidden state at
        EMB_LAYER [R, hidden] and its mean token NLL [R]. Responses are right-padded (causal, so harmless)."""
        q = self.chat(prompt)
        P = len(q)
        resp = [r if r else [self.tok.eos_token_id or 0] for r in responses]
        T = P + max(map(len, resp))
        pad = self.tok.pad_token_id if self.tok.pad_token_id is not None else 0
        ids = torch.tensor([q + r + [pad] * (T - P - len(r)) for r in resp], device=self.dev)
        m = torch.zeros(len(resp), T, device=self.dev)
        for i, r in enumerate(resp):
            m[i, P:P + len(r)] = 1
        self._cap = []
        try:
            with torch.inference_mode():
                last = self.sp.lm(input_ids=ids, use_cache=False).last_hidden_state
                nll = torch.stack([  # one row's logits at a time: the full [R, T, vocab] would not fit
                    torch.nn.functional.cross_entropy(self.sp.lm_head(last[i, P - 1:P - 1 + len(r)]).float(),
                                                      ids[i, P:P + len(r)]) for i, r in enumerate(resp)])
        finally:
            h, self._cap = self._cap[0].float(), None
        z = (h - self.mu) / self.sd
        pooled = (z * m[..., None]).sum(1) / m.sum(1, keepdim=True)
        return pooled, nll

    def forced(self, rows):
        """Teacher-forced: the model reads the unsteered replies to the profile prompts with each row's pushes applied.
        Returns per row the change those pushes cause in the final layer's hidden state, averaged over reply tokens and
        prompts [R, hidden]. The text is fixed, so this isolates what the layers after a push do with it from how
        decoding would have diverged."""
        R, H = len(rows), self.sp.cfg.hidden_size
        out = torch.zeros(R, H, device=self.dev)
        for b in self.base:
            q = self.chat(b["prompt"])
            ids = torch.tensor([q + (b["ids"] or [self.tok.eos_token_id or 0])] * (R + 1), device=self.dev)
            push = {}
            for r, ps in enumerate(rows):  # row 0 stays unsteered
                for layer, v in ps:
                    push.setdefault(layer, torch.zeros(R + 1, H, device=self.dev))[r + 1] += v
            self._push = push
            try:
                with torch.inference_mode():
                    last = self.sp.lm(input_ids=ids, use_cache=False).last_hidden_state[:, len(q):].float().mean(1)
            finally:
                self._push = {}
            out += last[1:] - last[0]
        return out / len(self.base)

    def _baseline(self, prompts):
        """Unsteered responses to prompts with their pools and NLLs."""
        out = []
        for p in prompts:
            (text, ids), = self.generate(p, [[]])
            pooled, nll = self.read(p, [ids])
            out.append({"prompt": p, "text": text, "ids": ids, "pool": pooled[0], "nll": float(nll[0])})
        return out

    # ---------- measuring ----------
    def measure(self, rows, base=None, generic=None):
        """Runs each row (a push list) on every prompt and measures it against the unsteered baseline. Returns per
        row: texts, raw shift [hidden], mean NLL, the worst prompt's distinct-2, and words that appear more than in the baseline
        (minus words random pushes produce anyway)."""
        base = base or self.base
        generic = self.generic if generic is None else generic
        R = len(rows)
        shifts = torch.zeros(R, self.sp.cfg.hidden_size, device=self.dev)
        texts, nll, d2, wc = [[] for _ in range(R)], torch.zeros(R), np.ones(R), [Counter() for _ in range(R)]
        for b in base:
            gen = self.generate(b["prompt"], rows)
            pooled, n = self.read(b["prompt"], [g[1] for g in gen])
            shifts += pooled - b["pool"]
            nll += n.cpu()
            bw = Counter(words(b["text"]))
            for r, (text, ids) in enumerate(gen):
                texts[r].append(text)
                d2[r] = min(d2[r], 0.0 if degenerate(text) else distinct2(ids))  # degenerate counts as fully looped
                wc[r].update({w: c for w, c in Counter(words(text)).items() if c > bw[w] and w not in generic})
        k = len(base)
        return [{"texts": texts[r], "shift": shifts[r] / k, "nll": float(nll[r] / k), "distinct": float(d2[r]),
                 "words": [w for w, _ in wc[r].most_common(8)]} for r in range(R)]

    def _load_controls(self, model):
        """Random unit directions at PROFILE_DOSE, N_CONTROLS per layer, measured once and cached on disk: per layer the
        mean shift they cause (subtracted from every neuron's) and the mean and spread of what is left (the strength
        scale); across layers, the words random pushes produce anyway (dropped from a neuron's distinctive words)."""
        key = hashlib.sha1(json.dumps([model, PROFILE_PROMPTS, PROFILE_DOSE, MAX_NEW, N_CONTROLS]).encode()).hexdigest()[:10]
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", f"controls-{key}.npz")
        if not os.path.exists(path):
            means, mus, sds, df = [], [], [], Counter()
            for layer in range(self.L):
                g = torch.Generator().manual_seed(1000 + layer)
                V = torch.randn(N_CONTROLS, self.sp.cfg.hidden_size, generator=g).to(self.dev)
                V = V / V.norm(dim=-1, keepdim=True)
                m = self.measure([[(layer, PROFILE_DOSE * self.norms[layer] * v)] for v in V], generic=set())
                S = torch.stack([x["shift"] for x in m])
                means.append(S.mean(0).cpu().numpy())
                s = (S - S.mean(0)).norm(dim=-1)
                mus.append(float(s.mean()))
                sds.append(float(s.std()))
                for x in m:
                    df.update(set(x["words"]))
                print(f"controls L{layer}: strength {mus[-1]:.2f} +- {sds[-1]:.2f}", flush=True)
            total = self.L * N_CONTROLS
            generic = sorted(w for w, c in df.items() if c >= 0.03 * total)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            np.savez(path, mean=np.stack(means), mu=np.array(mus), sd=np.array(sds), generic=np.array(generic))
        z = np.load(path)
        self.ctrl_mean = torch.tensor(z["mean"], device=self.dev)
        self.ctrl_mu, self.ctrl_sd = z["mu"].tolist(), z["sd"].tolist()
        self.generic = set(z["generic"].tolist())

    def embed(self, shift):
        e = shift @ self.proj
        return (e / e.norm().clamp(min=1e-6)).tolist()

    def profile(self, neurons, batch=24):
        """Card data for [(layer, n)]: texts on PROFILE_PROMPTS at PROFILE_DOSE, strength z against random directions,
        NLL, distinct-2, distinctive words and the embedding."""
        out = []
        for s in range(0, len(neurons), batch):
            chunk = neurons[s:s + batch]
            ms = self.measure([[self.push(l, n, PROFILE_DOSE)] for l, n in chunk])
            for (l, n), m in zip(chunk, ms):
                c = m["shift"] - self.ctrl_mean[l]
                z = (float(c.norm()) - self.ctrl_mu[l]) / max(self.ctrl_sd[l], 1e-6)
                out.append({"layer": l, "n": n, "texts": m["texts"], "words": m["words"], "nll": m["nll"],
                            "distinct": m["distinct"], "z": z, "shift": c, "embedding": self.embed(c)})
        return out

    # ---------- bounties ----------
    def _target(self, prompts, anchors):
        """Baseline and anchor shift for a bounty, cached: the shift in the unsteered model's reading when the reply
        is an on-target anchor instead of its own answer, averaged over prompts and anchors."""
        key = (tuple(prompts), tuple(anchors))
        if key not in self._targets:
            base = self._baseline(prompts)
            ids = [self.tok(a, add_special_tokens=False).input_ids for a in anchors]
            shift = torch.zeros(self.sp.cfg.hidden_size, device=self.dev)
            for b in base:
                pooled, _ = self.read(b["prompt"], ids)
                shift += pooled.mean(0) - b["pool"]
            self._targets[key] = (base, shift / len(base))
        return self._targets[key]

    def ask(self, question, prompts, replies):
        """The unsteered model as a yes/no judge: P(yes) that each reply (to the prompt beside it) fits `question`, from
        its next-token odds of yes against no. Rows are right-padded and read at their own last token (causal)."""
        rows = [self.chat(f'Someone asked: "{p}"\nThe reply was: "{r}"\n\n{question} Answer only yes or no.')
                for p, r in zip(prompts, replies)]
        T = max(map(len, rows))
        pad = self.tok.pad_token_id if self.tok.pad_token_id is not None else 0
        ids = torch.tensor([r + [pad] * (T - len(r)) for r in rows], device=self.dev)
        with torch.inference_mode():
            last = self.sp.lm(input_ids=ids, use_cache=False).last_hidden_state
            logits = self.sp.lm_head(torch.stack([last[i, len(r) - 1] for i, r in enumerate(rows)])).float()
        yes, no = (logits[:, self._answer_ids(w)].logsumexp(-1) for w in ("yes", "no"))
        return torch.sigmoid(yes - no).tolist()

    def _answer_ids(self, word):
        """First-token ids of a yes/no answer in its usual spellings."""
        return sorted({self.tok(v, add_special_tokens=False).input_ids[0] for v in (word, word.capitalize(), " " + word)})

    def judge(self, entries, prompts, anchors, question=None):
        """Scores bounty entries (each a list of (layer, n, dose)) on the hidden prompts. With a question, concept is
        how far the replies move the unsteered model's yes on it from the normal replies toward certain: per prompt
        (p - p0) / (1 - p0), averaged. Without one (bounties opened before the question judge), it's the old anchor
        cosine. The rest is shared; see _score."""
        if question is None:
            return self._judge_anchors(entries, prompts, anchors)
        key = ("base", tuple(prompts))
        if key not in self._targets:
            self._targets[key] = self._baseline(prompts)
        base = self._targets[key]
        p0 = self.ask(question, prompts, [b["text"] for b in base])
        rows = [[self.push(l, n, d) for l, n, d in e] for e in entries]
        out = []
        for e, m in zip(entries, self.measure(rows, base=base)):
            p = self.ask(question, prompts, m["texts"])
            concept = sum((pi - qi) / max(1 - qi, 1e-6) for pi, qi in zip(p, p0)) / len(p)
            out.append(self._score(e, m, concept))
        return out

    def _score(self, entry, m, concept):
        """coherence = 1 up to NLL 2.0, falling to 0 at 3.5, and 0 if any reply loops (distinct-2 under 0.5).
        efficiency = 1 up to a total dose of 0.5, then -0.25 per unit, floor 0.4 (convex/rules.ts efficiency() shows it
        on the page). score = 1000 x max(concept, 0) x coherence x efficiency."""
        coherence = min(1.0, max(0.0, (3.5 - m["nll"]) / 1.5)) * (m["distinct"] >= 0.5)
        dose = sum(abs(d) for _, _, d in entry)
        efficiency = min(1.0, max(0.4, 1 - 0.25 * (dose - 0.5)))
        return {"score": round(1000 * max(concept, 0.0) * coherence * efficiency, 1), "concept": round(concept, 4),
                "coherence": round(coherence, 3), "texts": m["texts"]}

    def _judge_anchors(self, entries, prompts, anchors):
        """The old judge: concept = cosine between the entry's shift and the anchors' shift. It rewards replies that
        share the anchors' words even when they aren't about the target, which is why new bounties use a question."""
        base, target = self._target(prompts, anchors)
        rows = [[self.push(l, n, d) for l, n, d in e] for e in entries]
        return [self._score(e, m, float(torch.nn.functional.cosine_similarity(m["shift"], target, dim=0)))
                for e, m in zip(entries, self.measure(rows, base=base))]
