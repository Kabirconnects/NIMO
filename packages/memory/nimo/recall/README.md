# Recall

How Nimo remembers. A question does not search a database — it *ignites*
the relevant neurons and lets activation spread along synapses. The
activated neighborhood is the answer.

## Human-like ordering (2026-11-07)

Recall ranks by relevance and strength, with a recency component: among
equally relevant memories, the more recent one surfaces first. Ageing
strength decays with time since `lastAccessedAt` (falling back to
`updatedAt`), but **reading does not refresh it** — recall is read-only.
Rehearsal is an explicit write, not a retrieval side effect.

## The recall pipeline (live, 2026-11-07)

1. **Query** — the user's message becomes retrieval cues.
2. **Search (hybrid, RRF)** — four independent rankings fused:
   - **BM25** keyword: `score += idf · (f·(k₁+1)) / (f + k₁(1−b+b·docLen/avgLen))`,
     k₁=1.5, b=0.75. Deterministic, no server.
   - **Entity** exact-name matching.
   - **Embedding cosine** (`cos(u,v) = u·v/(‖u‖‖v‖)`): hashed char n-gram
     vectors (dim 256), so morphological relatives ("automobile" ≈
     "automobiles") share buckets — the brain fires by *gist*, not exact
     words.
   - **Spreading activation** (below).
   Fusion: `RRF(d) = Σ 1/(60 + rankᵢ(d))` across the three ranked lists.
   Gist threshold: cosine > 0.15 keeps a semantic match alive.
3. **Activate** — spread activation through synapses from the RRF seeds
   (the brain-like step: connected memories that share no words with the
   query can still surface).
4. **Rank** — sorted newest-first (recency bias), importance tiebreak.
5. **Assemble** — build a compact context block: "What we are doing now"
   (newest 3) + "Skills you can use now" + recalled memories + evidence,
   never the whole graph.

## Spreading activation (live formula)

```
A(v) = S(v, q) + λ · Σ w(u,v) · A(u)      with λ = 0.5, decay = 0.6 per hop
```

- `A(v)` — activation of neuron v
- `S(v, q)` — RRF score of v for the query
- `w(u, v)` — synapse strength from u to v
- `λ` — how much neighbours influence each other

Bounded hops (≤ 4), per-hop decay. This *is* the neuron behaviour:
activation travels along synapses, decaying, so a thought reminds you
of another thought you never asked about — inspired by HippoRAG's
graph traversal, but implemented as bounded spreading activation, **not**
Personalized PageRank. There is no PageRank computation anywhere in the
engine; the legacy `page_rank` column is unused by ranking.

## Ageing + rehearsal

```
s(t) = s₀ / (1 + age/τ)    with τ = 30 days × (1 + importance)
```

Ageing is computed from `lastAccessedAt` when the score is calculated.
**Retrieval itself is read-only** (2026-11-12): recall never writes
`lastAccessedAt`, confidence, importance, degree or edges, so repeated
queries cannot silently strengthen a memory. Rehearsal has to be an
explicit write (a correction, consolidation, or an explicit touch),
not a side effect of reading. Neglect still fades; reading alone does not
refresh.

## Worked example (tested 2026-11-07)

- Query "automobile" → BM25 scores 1.00 on
  "vehicles are cars trucks automobiles" (shared "automobile" stem
  via char n-grams), cosine 0.356 vs. the plant memory's 0.072 →
  plant excluded by the 0.15 gist threshold.
- Cosine "cat dog pet" vs. "pet dog" = 0.71; vs. "rocket spaceship" = 0.
- RRF top for `[m1,m2,m3] + [m2,m1] + [m3,m1]` = `m1`.

## The principle

> Nimo remembers the connections, not everything. A small, activated
> neighborhood beats a full dump of the database every time.

## What goes here

- RRF (reciprocal rank fusion) parameters and calibration.
- Activation weight tuning — λ, hop count, decay.
- Cold-start vs warm-context recall.
- Worked recalls: "What database did I choose?" — trace the exact path
  activation takes, neuron by neuron.
