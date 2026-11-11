# Universal Benchmark Results — 2026-11-08

> Run the full suite: `tsx scripts/universal-benchmark-runner.ts`
> 6 axes, 60 questions. Honest report — failures included.

======================================================================
PAME UNIVERSAL BENCHMARK — 6 axes (the honest report)
======================================================================

Each axis measures a DIFFERENT capability. Failures are the point —
they show where the system is weak, which is what researchers report.

⚠️  MEMORY       pass 83% (10/12)  recall 83%  MRR 0.78  1.4ms
     no-answer accuracy 50% (2 questions; false positives fail)
     ❌ m8: "Who is the president of France?" — false positive: 2 unrelated memories returned
     ❌ m12: "What is the project called?" — not found in top-K

✅ RESEARCH     pass 100% (10/10)  recall 100%  MRR 0.90  1.9ms

⚠️  CODING       pass 80% (8/10)  recall 75%  MRR 0.80  0.9ms
     ❌ c2: "Which database did we choose?" — not found in top-K
     ❌ c9: "Common bugfix steps" — not found in top-K

⚠️  ROBOTICS     pass 90% (9/10)  recall 90%  MRR 0.85  1.0ms
     ❌ rb4: "How does steering work?" — not found in top-K

✅ ADAPTATION   pass 100% (10/10)  recall 100%  MRR 1.00  0.8ms

⚠️  FORGETTING   pass 80% (8/10)  recall 80%  MRR 0.80  0.7ms
     no-answer accuracy 80% (10 questions; false positives fail)
     ❌ f3: "What did we discuss for lunch?" — false positive: 1 unrelated memories returned
     ❌ f9: "Note to forget" — false positive: 1 unrelated memories returned

----------------------------------------------------------------------
OVERALL: 89% pass rate across 62 questions / 6 axes
Verdict: functional — works in most domains, known gaps below.

WHERE WE ARE BAD (report this, don't hide it):
  - memory: 2 failures. Worst: "Who is the president of France?"
  - coding: 2 failures. Worst: "Which database did we choose?"
  - robotics: 1 failures. Worst: "How does steering work?"
  - forgetting: 2 failures. Worst: "What did we discuss for lunch?"


## Raw per-axis details

### MEMORY

Pass rate: 83% (10/12)
Mean Recall: 83.3%
Mean MRR: 0.778
Mean Latency: 1.4ms

Failures:
- m8: "Who is the president of France?" — false positive: 2 unrelated memories returned
- m12: "What is the project called?" — not found in top-K

### RESEARCH

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 0.900
Mean Latency: 1.9ms

Failures:
None on this corpus.

### CODING

Pass rate: 80% (8/10)
Mean Recall: 75.0%
Mean MRR: 0.800
Mean Latency: 0.9ms

Failures:
- c2: "Which database did we choose?" — not found in top-K
- c9: "Common bugfix steps" — not found in top-K

### ROBOTICS

Pass rate: 90% (9/10)
Mean Recall: 90.0%
Mean MRR: 0.850
Mean Latency: 1.0ms

Failures:
- rb4: "How does steering work?" — not found in top-K

### ADAPTATION

Pass rate: 100% (10/10)
Mean Recall: 100.0%
Mean MRR: 1.000
Mean Latency: 0.8ms

Failures:
None on this corpus.

### FORGETTING

Pass rate: 80% (8/10)
Mean Recall: 80.0%
Mean MRR: 0.800
Mean Latency: 0.7ms

Failures:
- f3: "What did we discuss for lunch?" — false positive: 1 unrelated memories returned
- f9: "Note to forget" — false positive: 1 unrelated memories returned


## Interpretation

The axes that pass prove the universal substrate works on this corpus.
The axes that fail are the honest gaps — report them, don't hide them.
To claim research-grade proof, run this with a BLIND corpus (questions
written by someone who didn't build the system).
