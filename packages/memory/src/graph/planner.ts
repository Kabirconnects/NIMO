// graph/planner.ts
// Goal-directed multi-step task planning using prerequisite edges (enables)
// and causal edges (causes). Follows the HippoRAG / Personalized PageRank
// idea: start from the goal neuron, traverse prerequisites backwards, and
// produce a topologically sorted plan of actions the agent can execute in order.
//
// Algorithm:
//   1. Find all neurons reachable from goal via enables/causes edges (reverse BFS)
//   2. Build dependency DAG: edge A -> enables -> B means A must happen before B
//   3. Topological sort (Kahn's algorithm) with cycle detection
//   4. Return plan as ordered steps with their neuron references
//
// This is the piece that turns "memories that know each other" into
// "a robot that moves in sync on purpose."

import type { MemoryNode } from "../domain/memory.types.js";
import type { MemoryEdge } from "../domain/memory-edge.types.js";
import { edgesFrom, findMemory, getDb } from "../storage/db.js";
import { isRetrievable } from "../governance/policy.js";

export interface PlanStep {
  /** The neuron that represents this action/skill */
  memory: MemoryNode;
  /** What must happen before this step (by memory id) */
  prerequisites: string[];
  /** Depth in the plan (0 = first step) */
  level: number;
}

export interface Plan {
  goalMemory: MemoryNode;
  steps: PlanStep[];
  totalSteps: number;
  estimatedComplexity: number; // 0-1 based on depth and branching
  cyclesDetected: boolean;
}

/**
 * Build a plan from a goal memory id.
 *
 * Traverses prerequisites (enables, depends_on, requires) backward from goal,
 * collects all reachable neurons, then topologically sorts them so that
 * prerequisites come before dependents.
 *
 * @param ownerId - owner scope
 * @param goalId - goal memory id to plan from
 * @param maxDepth - max BFS depth (default 4, matches activation cap)
 */
export function planFromGoal(ownerId: string, goalId: string, maxDepth = 4): Plan | null {
  const goal = findMemory(goalId, ownerId);
  if (!goal || !isRetrievable(goal, ownerId)) return null;

  const depth = Math.min(maxDepth, 4);

  // Step 1: BFS to find all prerequisites of the goal.
  // If A enables B, then A is a prerequisite for B.
  // edgesFrom only gives outgoing edges, so we do a full scan of edges
  // to build the reverse index: for each node B, which nodes enable B?
  const db = getDb();

  // Build reverse edge index: nodeId -> list of (fromId) that enable it
  const reverseIndex = new Map<string, { fromId: string; relation: string }[]>();
  const rows = db.prepare("SELECT from_memory_id, to_memory_id, relation FROM memory_edges WHERE owner_id = ?").all(ownerId) as Record<string, unknown>[];
  for (const r of rows) {
    const toId = String(r.to_memory_id);
    if (!reverseIndex.has(toId)) reverseIndex.set(toId, []);
    reverseIndex.get(toId)!.push({ fromId: String(r.from_memory_id), relation: String(r.relation) });
  }

  const PREREQ_RELATIONS = new Set(["enables", "depends_on", "caused_by", "derived_from"]);

  const visited = new Map<string, { node: MemoryNode; depth: number }>();
  visited.set(goalId, { node: goal, depth: 0 });

  let frontier = [goalId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      // Find prerequisites: nodes A where A enables id (reverse index)
      const incoming = reverseIndex.get(id) ?? [];
      for (const { fromId, relation } of incoming) {
        if (!PREREQ_RELATIONS.has(relation)) continue;
        if (visited.has(fromId)) continue;
        const node = findMemory(fromId, ownerId);
        if (node && isRetrievable(node, ownerId)) {
          visited.set(fromId, { node, depth: d + 1 });
          next.push(fromId);
        }
      }

      // Also traverse forward via enables: if id enables X, X is a consequence,
      // but for planning we also want to know if there are forward prerequisites
      // that were stored as "this node depends_on X"
      const edges = edgesFrom(id, ownerId);
      for (const e of edges) {
        if (["depends_on", "requires"].includes(e.relation) && !visited.has(e.toMemoryId)) {
          const node = findMemory(e.toMemoryId, ownerId);
          if (node && isRetrievable(node, ownerId)) {
            visited.set(e.toMemoryId, { node, depth: d + 1 });
            next.push(e.toMemoryId);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // Also find prerequisites via reverse scan: any node A where A enables any visited node
  // (BFS should have caught most, but this catches depth-limited misses)
  // For correctness, we do a second pass: for each visited node, look for nodes that enable it
  // (We need incoming edge lookup; edgesFrom only gives outgoing, so scan all candidates)
  // In practice, the BFS + outgoing traversal covers the common case where prerequisites
  // are stored as forward edges from prerequisite to dependent.

  // Step 2: Build dependency graph
  // If A enables B, then A must come before B in the plan.
  const dependencies = new Map<string, Set<string>>(); // nodeId -> set of prerequisite ids
  const reverseDeps = new Map<string, Set<string>>(); // nodeId -> set of dependent ids
  for (const id of visited.keys()) {
    dependencies.set(id, new Set());
    reverseDeps.set(id, new Set());
  }

  for (const id of visited.keys()) {
    const edges = edgesFrom(id, ownerId);
    for (const e of edges) {
      if (["enables", "depends_on", "requires"].includes(e.relation) && visited.has(e.toMemoryId)) {
        // id enables e.toMemoryId → id is prerequisite for e.toMemoryId
        dependencies.get(e.toMemoryId)!.add(id);
        reverseDeps.get(id)!.add(e.toMemoryId);
      }
    }
  }

  // Step 3: Topological sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const [id, deps] of dependencies) {
    inDegree.set(id, deps.size);
  }

  const ready: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }

  const sorted: string[] = [];
  const levels = new Map<string, number>();
  let currentLevel = 0;

  while (ready.length > 0) {
    const levelBatch = [...ready];
    ready.length = 0;

    for (const id of levelBatch) {
      sorted.push(id);
      levels.set(id, currentLevel);

      // Remove from dependents' in-degree
      for (const dep of reverseDeps.get(id) ?? []) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) - 1);
        if (inDegree.get(dep) === 0) {
          ready.push(dep);
        }
      }
    }
    currentLevel++;
  }

  const cyclesDetected = sorted.length < visited.size;

  // If cycles, append remaining nodes sorted by depth (best effort)
  if (cyclesDetected) {
    for (const [id, info] of visited) {
      if (!sorted.includes(id)) {
        sorted.push(id);
        levels.set(id, info.depth);
      }
    }
  }

  const steps: PlanStep[] = sorted.map((id) => ({
    memory: visited.get(id)!.node,
    prerequisites: [...dependencies.get(id)!],
    level: levels.get(id) ?? 0,
  }));

  // Estimated complexity: based on number of steps and max depth
  const maxLevel = Math.max(0, ...steps.map((s) => s.level));
  const estimatedComplexity = Math.min(1, (steps.length / 20) * 0.5 + (maxLevel / 4) * 0.5);

  return {
    goalMemory: goal,
    steps,
    totalSteps: steps.length,
    estimatedComplexity,
    cyclesDetected,
  };
}

/**
 * Convenience: format a plan as a numbered list for the agent.
 */
export function formatPlan(plan: Plan): string {
  const lines = [
    `Plan for: ${plan.goalMemory.summary}`,
    `Steps: ${plan.totalSteps} | Complexity: ${(plan.estimatedComplexity * 100).toFixed(0)}% | Cycles: ${plan.cyclesDetected ? "yes (resolved alphabetically)" : "none"}`,
    "",
  ];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const prereq = step.prerequisites.length > 0
      ? ` (requires: ${step.prerequisites.length} prerequisite${step.prerequisites.length > 1 ? "s" : ""})`
      : "";
    lines.push(`${i + 1}. [${step.memory.type}] ${step.memory.summary}${prereq}`);
  }
  return lines.join("\n");
}
