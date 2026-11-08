# Universal Benchmark Results — 2026-11-08

> Run the full suite: `tsx scripts/universal-benchmark-runner.ts`
> 6 axes, 60 questions. Honest report — failures included.

======================================================================
PAME UNIVERSAL BENCHMARK — 6 axes (the honest report)
======================================================================

Each axis measures a DIFFERENT capability. Failures are the point —
they show where the system is weak, which is what researchers report.

✅ MEMORY       pass 100% (10/10)  recall 100%  MRR 0.70  2.9ms

✅ RESEARCH     pass 100% (10/10)  recall 100%  MRR 0.52  2.1ms

⚠️  CODING       pass 80% (8/10)  recall 75%  MRR 0.45  1.7ms
     ❌ c2: "Which database did we choose?" — not found in top-K
     ❌ c9: "Common bugfix steps" — not found in top-K

⚠️  ROBOTICS     pass 90% (9/10)  recall 90%  MRR 0.36  1.7ms
     ❌ rb4: "How does steering work?" — not found in top-K

✅ ADAPTATION   pass 100% (10/10)  recall 100%  MRR 1.00  1.8ms

✅ FORGETTING   pass 100% (10/10)  recall 100%  MRR 0.00  1.3ms

----------------------------------------------------------------------
OVERALL: 95% pass rate across 60 questions / 6 axes
Verdict: strong — universal substrate claim is supported.

WHERE WE ARE BAD (report this, don't hide it):
  - coding: 2 failures. Worst: "Which database did we choose?"
  - robotics: 1 failures. Worst: "How does steering work?"


## Raw per-axis details

### MEMORY

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.700
Mean Latency: 2.9ms

Failures:
None on this corpus.

### RESEARCH

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.520
Mean Latency: 2.1ms

Failures:
None on this corpus.

### CODING

Pass rate: 80% (8/10)
Mean Recall: 75.0%
Mean MRR: 0.453
Mean Latency: 1.7ms

Failures:
- c2: "Which database did we choose?" — not found in top-K
- c9: "Common bugfix steps" — not found in top-K

### ROBOTICS

Pass rate: 90% (9/10)
Mean Recall: 90.0%
Mean MRR: 0.363
Mean Latency: 1.7ms

Failures:
- rb4: "How does steering work?" — not found in top-K

### ADAPTATION

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 1.000
Mean Latency: 1.8ms

Failures:
None on this corpus.

### FORGETTING

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.000
Mean Latency: 1.3ms

Failures:
None on this corpus.


## Interpretation

The axes that pass prove the universal substrate works on this corpus.
The axes that fail are the honest gaps — report them, don't hide them.
To claim research-grade proof, run this with a BLIND corpus (questions
written by someone who didn't build the system).
