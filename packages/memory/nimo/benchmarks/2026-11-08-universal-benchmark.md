# Universal Benchmark Results — 2026-11-12

> Run the full suite: `tsx scripts/universal-benchmark-runner.ts`
> 6 axes, 62 questions. Honest report — failures included.
> Latency varies per run; pass/recall/MRR are the stable signals.

======================================================================
PAME UNIVERSAL BENCHMARK — 6 axes (the honest report)
======================================================================

Each axis measures a DIFFERENT capability. Failures are the point —
they show where the system is weak, which is what researchers report.

✅ MEMORY       pass 100% (12/12)  recall 100%  MRR 0.88  1.7ms
     no-answer accuracy 100% (2 questions; false positives fail)

✅ RESEARCH     pass 100% (10/10)  recall 100%  MRR 0.90  1.9ms

✅ CODING       pass 100% (10/10)  recall 95%  MRR 0.95  1.1ms

✅ ROBOTICS     pass 100% (10/10)  recall 100%  MRR 0.88  1.1ms

✅ ADAPTATION   pass 100% (10/10)  recall 100%  MRR 1.00  1.1ms

✅ FORGETTING   pass 100% (10/10)  recall 100%  MRR 1.00  0.6ms
     no-answer accuracy 100% (10 questions; false positives fail)

----------------------------------------------------------------------
OVERALL: 100% pass rate across 62 questions / 6 axes
Verdict: strong — universal substrate claim is supported.

WHERE WE ARE BAD: none on this corpus. (Try a larger, blind corpus.)


## Raw per-axis details

### MEMORY

Pass rate: 100% (12/12)
Mean Recall: 100.0%
Mean MRR: 0.875
Mean Latency: 1.7ms

Failures:
None on this corpus.

### RESEARCH

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.900
Mean Latency: 1.9ms

Failures:
None on this corpus.

### CODING

Pass rate: 100% (10/10)
Mean Recall: 95.0%
Mean MRR: 0.950
Mean Latency: 1.1ms

Failures:
None on this corpus.

### ROBOTICS

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.883
Mean Latency: 1.1ms

Failures:
None on this corpus.

### ADAPTATION

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 1.000
Mean Latency: 1.1ms

Failures:
None on this corpus.

### FORGETTING

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 1.000
Mean Latency: 0.6ms

Failures:
None on this corpus.


## Interpretation

Passing axes show the substrate retrieves the expected memories on this corpus;
failing axes are the honest gaps — report them, don't hide them.

## What this does NOT prove

- **Not blind.** The corpus and the questions were authored by the same person
  who built the retrieval pipeline, so lexical and keyword choices are correlated.
- **Small.** 62 questions over a synthetic corpus; these are retrieval
  checks, not an evaluation of reasoning, learning quality, or long-horizon memory.
- **Sparse negatives.** Only the memory/forgetting axes include no-answer questions,
  scored simply as "did any unrelated memory appear".
- **Hashed embeddings only.** No dense model embeddings or reranker, so pure
  paraphrase without shared vocabulary remains a known weakness.
- **Pass = retrieval hit.** It says nothing about whether an LLM would use the
  returned memory correctly.

Treat these percentages as regression signals for this repository, not as
benchmark claims comparable to published memory systems.
