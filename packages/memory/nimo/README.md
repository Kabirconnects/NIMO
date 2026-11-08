# Nimo — Associative Memory Lab

> **"Nimo is not an AI agent. Nimo is a memory."**

This folder is where the research lives. Not code, not specs — the *story* of
how Nimo learns to remember, how it forms connections, and how it adapts when
the world changes.

## What this is

Most agent memory systems are databases pretending to be brains. They store
text in a vector bag, retrieve by similarity, forget on timer. Nimo is
different by design:

- **Skills** (`skills/`) — the unit of learning. A skill is a procedure
  with a track record: name, when-to-use, steps, tools, use/success/failure
  counts, confidence. Distilled autonomously from gaps (toddler learning),
  curated by rehearsal, evolved promote/demote/archive.
- **Neurons** (`neurons/`) — individual memory nodes. A neuron holds one fact,
  preference, decision, or concept — with confidence, importance, and the
  evidence that made it real.
- **Synapses** (`synapses/`) — typed, directional connections between neurons.
  Not "related_to everything", but *supports*, *contradicts*, *depends_on*,
  *derived_from*. A synapse carries weight and confidence, just like a real
  one.
- **Cortex** (`cortex/`) — the governing layer. What Nimo is allowed to store,
  change, retrieve, share, and forget. The cortex is what stops the memory
  from lying to itself.
- **Learning** (`learning/`) — how neurons are formed from experience, when
  they merge, when they supersede, and how the system corrects itself without
  forgetting it was ever wrong.
- **Recall** (`recall/`) — how activation spreads. A question doesn't fetch
  from a database — it *ignites* the right neurons, spreads along synapses,
  and the activated neighborhood becomes the answer.
- **Memory Arena** (`memory-arena/`) — where competing memories meet:
  contradictions, supersessions, and the governance that decides what
  survives.
- **Experiments** (`experiments/`) — hypotheses, runs, results. What worked,
  what didn't, and what we changed because of it.
- **Papers** (`papers/`) — A-MEM, HippoRAG, AgeMem, robotics memory (2025-2026),
  and every source that taught Nimo something new. Notes, not copies.
  The skills line (2026-11-07) is PAME’s own research contribution:
  toddler-style autonomous skill creation and curation.
- **Benchmarks** (`benchmarks/`) — how we know Nimo actually remembers.
  Recall@K, precision, faithfulness, contradiction handling, deletion
  success — measured, not assumed.

## The principle

> **Sessions organize interactions. Neurons organize knowledge. Synapses
> connect knowledge. The cortex controls what survives.**

A user talks about MongoDB in January, debugs Nimo in March, and asks about
it in November. Nimo doesn't search session 8392 — it ignites the MongoDB
neuron, activation travels along synapses to the decision neuron, the
procedure neuron, the evidence neuron — and the *path* is the memory.

This is what makes Nimo more than a chatbot with a database. It is an
associative memory system that learns — and can be taught, measured, and
improved by anyone who wants to understand how machines might remember.

## How to use this folder

- **New idea?** Open `experiments/<date>-<idea>.md`, state the hypothesis,
  run it, write down the result.
- **Read a paper?** Drop the note in `papers/`. Compare what it says with
  what Nimo does. Write the gap.
- **Benchmark result?** Put the numbers in `benchmarks/` with the config
  that produced them.
- **Discovery about a neuron or synapse?** Describe it in `neurons/` or
  `synapses/` — what it is, when it forms, when it dies.
