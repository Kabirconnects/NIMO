# Lab Tool Integration: What Your Instruments Need from PAME

> **Date:** 2026-11-07
> **Author:** Nimo
> **Status:** Ready for implementation

## Objective

This document defines the integration contract between laboratory instruments, tools, and the Nimo Associative Memory Engine (PAME). Lab tools (motors, sensors, wet-lab robotics, actuators) plug into the universal memory substrate without coupling to PAME internals. This keeps the engine domain-agnostic and prepares it for any physical or scientific domain.

## 1. Standardize on Universal Node Types

Your motors, sensors, and actuators do not invent custom schema types. They map to the universal node types already defined in `MemoryType`:

| Instrument / Process         | Memory Type   | JSON payload shape                              |
| --------------------------- | ------------- | ----------------------------------------------- |
| Raw perception observations  | `sensor`      | {modality, data, timestamp, uncertainty}        |
| Action command → outcome     | `trajectory`   | {command, result, reward, context, dynamics}     |
| Testable prediction          | `hypothesis`  | {claim, prediction, test, falsifiable}          |
| Protocol + results           | `experiment`  | {protocol, observations, conclusion, replication}|

**Why:** A robotics lab's force sensors become `sensor` nodes, while motor trajectories become `trajectory` nodes. A wet-lab robotic arm becomes a sequence of `trajectory` nodes plus one `experiment` node wrapping the full protocol.

## 2. Implement Causal Relations Between Physical Processes

Physical systems obey causality. Map your lab signals to typed edges:

```
"causes": steer → turn      (steering input causes wheel rotation)
"enables": calibration → experiment
"observes": sensor → trajectory
```

Each relation carries `weight` and `confidence`. Example:

```json
{
  "fromMemoryId": "<steering_node_id>",
  "toMemoryId": "<turn_node_id>",
  "relation": "causes",
  "confidence": 0.85,
  "weight": 0.7
}
```

**Why:** Causal chains let the agent plan multi-step tasks by following prerequisites (`enables`) and consequences (`causes`), exactly like human procedural memory chains actions in sequence.

## 3. Publish Procedures as `hypothesis` → `experiment` → `replicates` Chains

Every laboratory procedure follows the scientific method, which maps directly onto the memory graph:

```
hypothesis: "Lowering temperature reduces colony formation rate"
    │
    ├── tests ──────────────────────────────► experiment #1
    │                                        (protocol, observations, conclusion)
    │
    └── replicates ─────────────────────────► experiment #2
                                            (same protocol, independent data)
```

Each `experiment` node stores `protocol`, `observations`, `conclusion`, and `replication` status. Connecting multiple experiments with `replicates` lets the agent know whether a protocol has been validated reproducibly.

**Why:** Automated science systems (self-driving labs) require this structure to learn from failed experiments without discarding the negative results.

## 4. Keep Tool Implementations Separate from Memory

Lab tool implementations belong in the tools foundry or workspaces, **not** inside `packages/memory`.

| What goes where | Why separation matters |
| -------------- | ---------------------- |
| `packages/memory`  | Universal substrate only — `sensor`, `trajectory`, `hypothesis`, `experiment` nodes + causal edges |
| Tools foundry/workspaces | Domain-specific tool implementations that feed data into memory |

A motor controller tool calls `remember({type: "trajectory", content: <structured>})` but never touches SQLite, embeddings, or graph code directly.

**Why:** Decoupling lets a new domain be added without modifying the memory core — the same substrate serves robotics, genomics, physics, or linguistics.

## 5. How to Start Implementation

1. Define a Zod schema per instrument type that validates its payload into one of the universal types.
2. Create a `lab-tools.ts` module that wraps each instrument call with `memoryService.createMemory()` and `memoryService.linkMemories()`.
3. Build causal edge inference rules for your specific hardware (e.g., if steering → turn, if temperature change → phenotype).
4. Link experiments as `replicates` chains so failed protocols are preserved for future use.
5. Do not import any database, embedding, or graph traversal modules into your tools — rely solely on the public PAME API surface.

## 6. Verification Checklist

Before declaring integration complete, verify:

- [ ] Storing a `sensor` node with a structured payload does not throw.
- [ ] Storing a `trajectory` node returns an ID; retrieving by query works.
- [ ] Creating a `hypothesis` followed by an `experiment` connected via `tests` succeeds.
- [ ] Linking two memories with `causes` creates the edge without errors.
- [ ] Recalling "turn the robot left" surfaces the trajectory node via graph activation.
- [ ] Recalling "run the PCR protocol" surfaces the experiment chain.
- [ ] No module imports from `storage/db.ts` in the tool layer.
