# PAME research notebook

Paper notes, experiments, and benchmark results live here.

## Reading order

1. A-MEM (NeurIPS 2025) — dynamic memory notes, linking, evolution.
2. HippoRAG (NeurIPS 2024) — KG + Personalized PageRank, multi-hop retrieval.
3. AgeMem (ACL 2026) — memory ops as agent actions, autonomous governance.
4. **Robotics memory (2025-2026)** — how humanoid robots structure episodic
   memory: `memories` + `memory_edges` + `experiences` + new `skills` table
   mirrors the cognitive core of lab humanoids (RT-2 / ACT-1 style world
   models: one continuous stream, graph associations, outcome-weighted
   skills, continual substrate updating without retraining the base model).
   Our delta vs labs: type-only storage today (no sensor/trajectory nodes
   yet) — physical signals are the next paper.

## Skills as a research line (2026-11-07)

Skills are PAME’s answer to "how does a memory *grow capability*, not
just facts?" — the unit of learning is a procedure with a track record
(success/use, recency ageing, promote/demote/archive lifecycle),
distilled autonomously from gaps (toddler learning) and curated by
rehearsal. Benchmark target: does skill-retrieval beat pure
memory-retrieval on multi-step tasks?

## Benchmarks (Stage 7)

Compare three retrieval configurations before assuming graph complexity helps:
vector-only / vector+keyword+entity / hybrid+graph. Record Recall@K,
Precision@K, MRR, faithfulness, contradiction & deletion accuracy, latency, cost.

Test categories: direct, cross-conversation, semantic, multi-hop, temporal,
contradiction, correction, negative, forgetting, isolation (cross-owner).
