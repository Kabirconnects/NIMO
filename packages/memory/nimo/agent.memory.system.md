# Nimo Associative Memory Engine (PAME)

Design objective: Nimo should remember information across conversations, connect related experiences automatically, retrieve knowledge by association rather than conversation ID, and continuously refine its memory without silently turning uncertain statements into facts.

The architecture should behave more like an evolving knowledge network than a conventional chat-history database.

My recommendation is to build PAME as a session-independent, graph-organized, hybrid-retrieval memory system with explicit memory governance.

One important distinction: Nimo can use computational ideas inspired by human memory—associative activation, consolidation, retrieval cues, and temporal context—but it will not literally reproduce the human brain.

## 1. Research foundation

There are several relevant research directions. They point toward combining multiple techniques rather than implementing a simple vector database.

[A-Mem智能记忆系统——让大语言模型智能体拥有“记忆“的革命性方法！\_locomo 测试集的测试结果在哪儿可以看到-CSDN博客](https://images.openai.com/static-rsc-4/-wuuHJxrCKl7_z7YOXS6ydK6lwfICNztf_IkYl877uH7hZg0mzwk75OrHEdQikzEl1bAT7Aj178Dnfc1-2BwuRVHCxBbSXaziTRpAwLYhkeP6GsErMMw08FdENvgnwNHn7FiQBOq49vbuLO4aamrOB-4XclApzVTbxpCTsSC4Oc?purpose=inline)

1\. A-MEM — NeurIPS 2025

Dynamic memory notes, contextual descriptions, keywords, tags, linking, and memory evolution. This is the closest research foundation for Nimo's Obsidian-like associative memory.

[NeurIPS paper](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html?utm_source=chatgpt.com) · [arXiv](https://arxiv.org/abs/2502.12110?utm_source=chatgpt.com) · [Research implementation](https://github.com/agiresearch/A-mem?utm_source=chatgpt.com)

[image](https://www.google.com/s2/favicons?domain=https://proceedings.neurips.cc\&sz=32)

NeurIPS Proceedings+1

[Week 9: 고급 RAG 아키텍처 — Deep Learning for NLP 2025](https://images.openai.com/static-rsc-4/qXnzbtZNKqcZP75f6inrhgxG_kY7aHFf8JldsvwOVqBcZBzhYanzYrT9O40Yhysy5R0SVoC_HhRryPVo1fqvFqtk9HhEJOaXo2vH-hFzGVlu7i8cjZv33yCmpUP1M1igKWc051vpkns1rfLNcjVQvSaehSgmk_umV-5WLT2lCUo?purpose=inline)

2\. HippoRAG — NeurIPS 2024

Combines knowledge graphs, language models, and Personalized PageRank to retrieve connected information across multiple reasoning steps.

[NeurIPS paper](https://proceedings.neurips.cc/paper_files/paper/2024/hash/6ddc001d07ca4f319af96a3024f6dbd1-Abstract-Conference.html?utm_source=chatgpt.com) · [Research implementation](https://github.com/OSU-NLP-Group/HippoRAG?utm_source=chatgpt.com)

[image](https://www.google.com/s2/favicons?domain=https://proceedings.neurips.cc\&sz=32)

NeurIPS Proceedings

[Agentic Memory: Learning Unified Long-Term and Short-Term Memory Management for Large Language Model Agents | Oceann Devlog](https://images.openai.com/static-rsc-4/K-HyjtLW3lAE8jBHU-L5tRJ_3dLc5Hc96sE6ABY7q3guFRbcRGsSF5nZ5E9j49PQQjMUmxVeHdMbYT1ru6_NRQJMG1ydBOw7UvIglSPkPDQ0SoiulotJXsY32OSqDHg5tAWmQqNLDJKr4psqFrtzt6Jm7abqLEcXMlzXXX8T98k?purpose=inline)

3\. AgeMem — ACL 2026

Treats memory management as agent actions: store, retrieve, update, summarize, and discard. This informs Nimo's memory-management tools and autonomous governance.

[ACL paper](https://aclanthology.org/2026.acl-long.981/?utm_source=chatgpt.com) · [arXiv](https://arxiv.org/abs/2601.01885?utm_source=chatgpt.com)

[image](https://www.google.com/s2/favicons?domain=https://aclanthology.org\&sz=32)

ACL Anthology+1

### What Nimo should take from each

| Research | Nimo implementation                                        |
| -------- | ---------------------------------------------------------- |
| A-MEM    | Dynamic notes, automatic links, memory evolution           |
| HippoRAG | Associative graph traversal and ranked activation          |
| AgeMem   | Memory operations as agent tools and autonomous management |

These are research foundations, not proof that one architecture is universally optimal. PAME should be evaluated against a simpler vector-only baseline before assuming graph complexity improves results.

## 2. The architecture

The central idea is that conversation sessions are sources of experience, not the structure of long-term memory.

A user might discuss MongoDB in one conversation, return to it three weeks later while discussing Nimo, and mention it again while debugging a database issue. Nimo should connect those experiences because they share concepts—not because they have the same session ID.

## PAME — system architecture

Nimo Agent Runtime

Chat · Plan · Auto · Tools

Memory interface

remember · recall · update · forget · explain

Ingestion pipeline

Capture → extract → validate → consolidate

Retrieval pipeline

Query → search → activate → rank → assemble

Associative memory network

Memory nodes

Facts, events, decisions, concepts

Memory edges

Related, supports, contradicts, derives

Experience store

Original messages and tool events

Indexes

Vector, text, entity, time

MongoDB persistence + background workers

Ownership · governance · audit · jobs

### The five memory layers

1. Experience layer: What actually happened—messages, tool calls, results, and timestamps.
2. Memory layer: What Nimo believes is worth retaining—facts, preferences, decisions, events, procedures, and concepts.
3. Association layer: How memories relate to each other.
4. Index layer: How memories are found efficiently.
5. Governance layer: What Nimo is permitted to store, change, retrieve, share, and forget.

Do not collapse these into one MongoDB collection. Each layer has a different responsibility.

## 3. Memory governance

This is the most important part of the design.

Nimo should be autonomous in forming and organizing memories, but it should not be allowed to invent certainty, override explicit corrections, or retain information against the user's instructions.

### 3.1 Memory lifecycle

1. Capture

   Preserve the original interaction as an experience record. Do not immediately turn every sentence into permanent memory.
2. Extract

   Identify candidate facts, events, decisions, preferences, entities, relationships, and tasks.
3. Validate

   Determine whether each candidate is explicit, inferred, uncertain, duplicated, sensitive, or contradictory.
4. Consolidate

   Merge duplicate candidates, update existing memories when justified, and create new ones when necessary.
5. Associate

   Search for related nodes and create typed, evidence-backed graph edges.
6. Index

   Generate embeddings and update text, keyword, entity, and temporal indexes.
7. Retrieve and use

   Retrieve relevant memories for the current task, with provenance and confidence.
8. Review and maintain

   Reconcile contradictions, expire temporary memories, strengthen useful associations carefully, and apply deletion requests.

### 3.2 Memory types

Use explicit types rather than treating all extracted text as the same thing.

| Type          | Example                             | Retention                        |
| ------------- | ----------------------------------- | -------------------------------- |
| `fact`        | Nimo uses MongoDB                   | Until superseded                 |
| `preference`  | Prefers explanations with code      | Until changed                    |
| `decision`    | Chose MongoDB for the first version | Until revised                    |
| `event`       | Fixed a model registry error        | Historical                       |
| `concept`     | Associative memory architecture     | Long-term if useful              |
| `procedure`   | How to start the Nimo API           | Until outdated                   |
| `goal`        | Build a complete agent harness      | Until completed or changed       |
| `observation` | API returned an undefined model     | Evidence, not necessarily a fact |

A memory can have more than one label in its metadata, but it should have one primary type for predictable handling.

### 3.3 Governance rules

1\. Explicit statements outrank inference

A user explicitly saying a preference is stronger evidence than an AI-generated guess.

2\. Corrections outrank old memories

A new explicit correction supersedes an outdated claim; preserve the history rather than silently rewriting it.

3\. Contradictions are retained

Do not arbitrarily choose between two conflicting claims.

4\. Sensitive data is restricted

Do not create persistent memories of passwords, API keys, authentication secrets, or highly sensitive personal information.

5\. Every memory has provenance

Nimo must be able to explain which interaction or evidence supports a memory.

6\. Deletion propagates

A forget request must remove or invalidate derived notes, edges, embeddings, and search-index entries.

7\. No cross-user leakage

Every retrieval, graph traversal, and write is scoped to the authenticated owner or explicitly authorized shared workspace.

Important: Keep an audit trail of memory changes, but do not keep deleted sensitive content in an audit log. Record the deletion operation and identifiers, not the secret itself.

### 3.4 Autonomous governance decisions

PAME should make routine decisions automatically:

- Create a memory from a useful interaction.
- Merge duplicate memories.
- Link related memories.
- Update a procedure when new evidence supersedes it.
- Reduce confidence when contradictory evidence appears.
- Mark outdated memories as superseded.
- Remove expired temporary data.

It should not autonomously:

- Convert speculation into a verified personal fact.
- Override an explicit user correction.
- Store credentials or secrets.
- Expand a private memory into a shared workspace.
- Ignore an explicit forget or deletion instruction.

This is autonomous memory management with policy enforcement, not unrestricted self-modification.

## 4. TypeScript domain model

Keep the domain types independent from Mongoose, Express, and the Vercel AI SDK. That lets you change your database or model provider without rewriting the memory engine.

Suggested package structure:

```
packages/
└── memory/
    └── src/
        ├── domain/
        │   ├── memory.types.ts
        │   ├── memory-node.types.ts
        │   ├── memory-edge.types.ts
        │   ├── experience.types.ts
        │   └── governance.types.ts
        ├── ingestion/
        │   ├── capture.ts
        │   ├── extract.ts
        │   ├── validate.ts
        │   ├── consolidate.ts
        │   └── ingest.ts
        ├── graph/
        │   ├── link.ts
        │   ├── traverse.ts
        │   └── evolve.ts
        ├── retrieval/
        │   ├── search.ts
        │   ├── activate.ts
        │   ├── rank.ts
        │   └── assemble.ts
        ├── governance/
        │   ├── policy.ts
        │   ├── forget.ts
        │   └── audit.ts
        ├── storage/
        │   ├── models/
        │   ├── repositories/
        │   └── indexes/
        ├── workers/
        │   ├── ingestion.worker.ts
        │   └── maintenance.worker.ts
        └── index.ts
```

### 4.1 Core types

`domain/memory.types.ts`

```
export type MemoryType =
  | "fact"
  | "preference"
  | "decision"
  | "event"
  | "concept"
  | "procedure"
  | "goal"
  | "observation";

export type MemoryStatus =
  | "candidate"
  | "active"
  | "superseded"
  | "archived"
  | "deleted";

export type MemoryVisibility =
  | "private"
  | "workspace"
  | "shared";

export type EvidenceKind =
  | "explicit"
  | "inferred"
  | "observed"
  | "tool_result";

export interface MemoryEvidence {
  experienceId: string;
  messageId?: string;

  kind: EvidenceKind;

  quote?: string;
  sourceDescription?: string;

  observedAt: Date;
}

export interface MemoryNode {
  id: string;
  ownerId: string;

  type: MemoryType;
  status: MemoryStatus;
  visibility: MemoryVisibility;

  content: string;
  summary: string;

  concepts: string[];
  keywords: string[];
  tags: string[];

  entities: MemoryEntityReference[];

  confidence: number;
  importance: number;

  evidence: MemoryEvidence[];

  validFrom?: Date;
  validUntil?: Date;

  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;

  supersedes?: string[];
  supersededBy?: string;
}

export interface MemoryEntityReference {
  entityId: string;
  name: string;
  type: string;
}
```

### 4.2 Graph edge types

`domain/memory-edge.types.ts`

```
export type MemoryRelation =
  | "related_to"
  | "about"
  | "supports"
  | "contradicts"
  | "explains"
  | "caused_by"
  | "part_of"
  | "derived_from"
  | "supersedes"
  | "depends_on"
  | "occurred_before"
  | "occurred_after";

export interface MemoryEdge {
  id: string;
  ownerId: string;

  fromMemoryId: string;
  toMemoryId: string;

  relation: MemoryRelation;

  weight: number;
  confidence: number;

  evidenceIds: string[];

  createdAt: Date;
  updatedAt: Date;
}
```

A key design decision: an edge must have a relationship type. A generic `related_to` edge is useful, but it cannot replace `contradicts`, `supports`, or `supersedes`.

Also, don't automatically make every edge bidirectional. Some relationships have direction:

- A decision `depends_on` a requirement.
- A newer memory `supersedes` an older one.
- An observation `derived_from` an experience.
- An event `occurred_before` another event.

### 4.3 Experience types

`domain/experience.types.ts`

```
export type ExperienceType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "system_observation"
  | "external_document";

export interface Experience {
  id: string;
  ownerId: string;

  // Optional source conversation metadata.
  conversationId?: string;
  messageId?: string;

  type: ExperienceType;

  content: string;
  contentHash: string;

  occurredAt: Date;
  capturedAt: Date;

  metadata: Record<string, unknown>;
}
```

This is where your session question becomes important.

`conversationId` is optional provenance. It is not the primary key for memory retrieval. Nimo can find related memories from different conversations through their content, entities, embeddings, and graph edges.

Never remove internal identifiers entirely. You still need stable IDs for updating nodes, deduplication, deletion, and tracing sources.

### 4.4 Governance types

`domain/governance.types.ts`

```
export type MemoryAction =
  | "create"
  | "update"
  | "link"
  | "merge"
  | "archive"
  | "supersede"
  | "delete"
  | "retrieve";

export type GovernanceDecision =
  | "allow"
  | "deny"
  | "require_confirmation";

export interface MemoryPolicy {
  allowAutomaticCapture: boolean;
  allowInferredMemories: boolean;
  allowAutomaticMerge: boolean;
  allowAutomaticEvolution: boolean;

  defaultVisibility: MemoryVisibility;

  maxEvidenceAgeDays?: number;
  maxMemoryConfidenceForAutoActivation: number;

  excludedCategories: string[];
}

export interface GovernanceResult {
  decision: GovernanceDecision;
  reason: string;
  requiresConfirmation: boolean;
}
```

A policy belongs to the user or workspace—not to an individual conversation.

The policy engine should run before persistence and before retrieval. This prevents a memory from being saved in a prohibited category and prevents unauthorized memories from appearing in an agent's context.

## 5. MongoDB data model

For Nimo's first implementation, I recommend MongoDB rather than adding Neo4j immediately.

You already use MongoDB in your stack. You can represent a graph with nodes and edges in ordinary collections, then perform controlled graph traversal in TypeScript.

Use these collections:

| Collection        | Responsibility                                 |
| ----------------- | ---------------------------------------------- |
| `experiences`     | Original interaction evidence                  |
| `memories`        | Consolidated memory nodes                      |
| `memory_edges`    | Relationships between nodes                    |
| `memory_entities` | Canonical people, products, projects, concepts |
| `memory_policies` | User/workspace governance                      |
| `memory_jobs`     | Async ingestion and maintenance jobs           |
| `memory_audit`    | Memory operation history                       |

### 5.1 Mongoose memory schema

`storage/models/memory.model.ts`

```
import { Schema, model } from "mongoose";

const evidenceSchema = new Schema(
  {
    experienceId: {
      type: String,
      required: true,
    },
    messageId: String,

    kind: {
      type: String,
      enum: ["explicit", "inferred", "observed", "tool_result"],
      required: true,
    },

    quote: String,
    sourceDescription: String,
    observedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

const entityReferenceSchema = new Schema(
  {
    entityId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const memorySchema = new Schema(
  {
    ownerId: {
      type: String,
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "fact",
        "preference",
        "decision",
        "event",
        "concept",
        "procedure",
        "goal",
        "observation",
      ],
      required: true,
    },

    status: {
      type: String,
      enum: ["candidate", "active", "superseded", "archived", "deleted"],
      default: "candidate",
      index: true,
    },

    visibility: {
      type: String,
      enum: ["private", "workspace", "shared"],
      default: "private",
    },

    content: {
      type: String,
      required: true,
    },

    summary: {
      type: String,
      required: true,
    },

    concepts: [String],
    keywords: [String],
    tags: [String],

    entities: [entityReferenceSchema],

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },

    importance: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },

    evidence: [evidenceSchema],

    validFrom: Date,
    validUntil: Date,

    supersedes: [String],
    supersededBy: String,

    embedding: {
      type: [Number],
      select: false,
    },

    lastAccessedAt: Date,
  },
  {
    timestamps: true,
    collection: "memories",
  },
);

memorySchema.index({
  ownerId: 1,
  status: 1,
  type: 1,
});

memorySchema.index({
  ownerId: 1,
  "entities.entityId": 1,
});

memorySchema.index({
  ownerId: 1,
  concepts: 1,
});

memorySchema.index({
  ownerId: 1,
  updatedAt: -1,
});

export const MemoryModel = model("Memory", memorySchema);
```

For a production deployment, use a MongoDB Atlas Vector Search index on the `embedding` field, with `ownerId`, `status`, and visibility as filterable fields. The ordinary Mongoose indexes above do not create a vector index.

### 5.2 Edge schema

`storage/models/memory-edge.model.ts`

```
import { Schema, model } from "mongoose";

const memoryEdgeSchema = new Schema(
  {
    ownerId: {
      type: String,
      required: true,
      index: true,
    },

    fromMemoryId: {
      type: String,
      required: true,
    },

    toMemoryId: {
      type: String,
      required: true,
    },

    relation: {
      type: String,
      enum: [
        "related_to",
        "about",
        "supports",
        "contradicts",
        "explains",
        "caused_by",
        "part_of",
        "derived_from",
        "supersedes",
        "depends_on",
        "occurred_before",
        "occurred_after",
      ],
      required: true,
    },

    weight: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },

    evidenceIds: [String],
  },
  {
    timestamps: true,
    collection: "memory_edges",
  },
);

memoryEdgeSchema.index({
  ownerId: 1,
  fromMemoryId: 1,
});

memoryEdgeSchema.index({
  ownerId: 1,
  toMemoryId: 1,
});

memoryEdgeSchema.index(
  {
    ownerId: 1,
    fromMemoryId: 1,
    toMemoryId: 1,
    relation: 1,
  },
  { unique: true },
);

export const MemoryEdgeModel = model(
  "MemoryEdge",
  memoryEdgeSchema,
);
```

That unique compound index prevents the same directed relationship from being created repeatedly. If you want parallel relationships with different evidence, store multiple evidence records on one edge rather than creating duplicate edges.

### 5.3 Experience schema

```
import { Schema, model } from "mongoose";

const experienceSchema = new Schema(
  {
    ownerId: {
      type: String,
      required: true,
      index: true,
    },

    conversationId: String,
    messageId: String,

    type: {
      type: String,
      enum: [
        "message",
        "tool_call",
        "tool_result",
        "system_observation",
        "external_document",
      ],
      required: true,
    },

    content: {
      type: String,
      required: true,
    },

    contentHash: {
      type: String,
      required: true,
    },

    occurredAt: {
      type: Date,
      required: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "experiences",
  },
);

experienceSchema.index(
  { ownerId: 1, contentHash: 1 },
  { unique: true },
);

export const ExperienceModel = model(
  "Experience",
  experienceSchema,
);
```

This assumes that identical content should be captured only once per owner. If you need to preserve repeated occurrences, change the uniqueness strategy to include the source message or event ID.

### 5.4 Other collections

`memory_entities` should canonicalize entities:

```
interface MemoryEntity {
  id: string;
  ownerId: string;

  canonicalName: string;
  aliases: string[];

  type:
    | "person"
    | "project"
    | "technology"
    | "organization"
    | "concept"
    | "product"
    | "place";

  description?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

For example, `Nimo`, `Nimo project`, and `the agent harness` may refer to the same project. Entity resolution should propose that connection, then merge aliases only when confidence is sufficient.

`memory_policies` stores the user's policy settings.

`memory_jobs` stores retryable ingestion, embedding, and graph-maintenance jobs.

`memory_audit` stores who or what performed a memory operation, its target, timestamp, and reason.

## 6. Ingestion pipeline: how Nimo learns

Ingestion is the process that converts interaction history into useful, structured memories.

Do not make the agent directly write arbitrary memory documents to MongoDB. Give it typed memory operations, then validate every operation in the memory service.

### 6.1 Ingestion flow

1

1\. Capture experience

Store the original user message or tool result.

2

2\. Detect memory candidates

Identify facts, decisions, preferences, events, concepts, and goals.

3

3\. Apply governance

Reject prohibited content and classify uncertainty.

4

4\. Resolve entities

Match names and aliases to existing canonical entities.

5

5\. Find duplicates

Search for equivalent memories before creating new ones.

6

6\. Consolidate

Create, update, merge, or supersede a memory.

7

7\. Generate associations

Find related nodes and validate relationship types.

8

8\. Embed and index

Generate embeddings and update search indexes.

### 6.2 Extraction result

The LLM should produce a structured result, not a free-form paragraph.

```
export interface MemoryCandidate {
  type: MemoryType;

  content: string;
  summary: string;

  concepts: string[];
  keywords: string[];
  tags: string[];

  entities: {
    name: string;
    type: string;
  }[];

  evidence: {
    quote: string;
    kind: EvidenceKind;
  };

  confidence: number;
  importance: number;

  temporal: {
    validFrom?: string;
    validUntil?: string;
  };
}
```

Use Zod to validate the LLM's output before any database write.

The extraction prompt should instruct the model to:

- Extract only information supported by the experience.
- Preserve uncertainty and attribution.
- Separate a user's statement from an independently verified fact.
- Avoid creating memories from casual filler.
- Avoid storing credentials and prohibited sensitive content.
- Identify whether the information updates or contradicts an existing memory.
- Return no candidates when nothing is worth remembering.

Example

Suppose the user says:

> I'm building Nimo using TypeScript, Express, MongoDB and the Vercel AI SDK.

Nimo might create these memories:

Candidate memory

Explicit evidence

Nimo uses TypeScript

Type: fact · Concept: Nimo project · Confidence: 0.99

Nimo uses Express

Type: fact · Concept: Nimo project · Confidence: 0.99

Nimo uses MongoDB

Type: fact · Concept: Nimo project · Confidence: 0.99

Nimo uses Vercel AI SDK

Type: fact · Concept: Nimo project · Confidence: 0.99

These are four independently addressable memories, not one giant paragraph. They can be retrieved separately and connected through the `Nimo` entity.

### 6.3 Ingestion service contract

```
export interface IngestExperienceInput {
  ownerId: string;

  conversationId?: string;
  messageId?: string;

  content: string;
  type: ExperienceType;

  occurredAt?: Date;
}

export interface IngestionResult {
  experienceId: string;

  created: number;
  updated: number;
  merged: number;
  linked: number;
  rejected: number;

  memoryIds: string[];
}

export interface MemoryIngestionService {
  ingest(
    input: IngestExperienceInput,
  ): Promise<IngestionResult>;
}
```

The ingestion service should be idempotent: retrying a job must not create duplicate memories or duplicate edges.

### 6.4 Synchronous vs asynchronous ingestion

Do not block every chat response while Nimo performs a full graph consolidation.

Recommended runtime:

1. Save the experience synchronously.
2. Retrieve existing relevant memories for the current turn.
3. Generate the assistant response.
4. Enqueue memory ingestion.
5. A worker extracts, validates, consolidates, links, and indexes.
6. The next turn can retrieve the newly consolidated memory when the job completes.

For an explicit command such as "remember this", Nimo should acknowledge only after the memory has been accepted and persisted.

## 7. Graph linking: how memories become associated

This is where PAME becomes more than ordinary RAG.

A vector database can identify semantically similar memories. A graph allows Nimo to traverse meaningful relationships between memories even when their wording is very different.

### 7.1 Example memory graph

Suppose Nimo has learned these things over several separate conversations:

## Example: Nimo's memory network

[This is how I’m applying Andrej Karpathy’s LLM Knowledge Bases in research.  In long technical investigations, one of biggest challenges is context management: keeping the project’s understanding… | Marc Vendrell Feliu](https://images.openai.com/static-rsc-4/HYQ2XjaS0SJIsVKQfkDuWe3lXNhauL3wZadYH0nMAQe9JNnp63v4eg3A9sB2F8U6M0p0WVA4ftIO2vSp-VQF6akfUT6qZv-eP-nge2rEw3g5Yb-6Z_DiypuEu18slvPQeCq17I0vhwsj8alip-wz8p2Ngf71cJ4-ddiKFb-LSw0?purpose=inline)

[linkedin.com](https://www.linkedin.com/posts/marc-vendrell-feliu_this-is-how-im-applying-andrej-karpathy-activity-7447930450699771904-nmQj?utm_source=chatgpt.com)

Nimo

Project entity

TypeScript

Technology

MongoDB

Technology

Vercel AI SDK

Framework

Associative memory

Architecture concept

Illustrative network, not a graph retrieved from an actual Nimo database.

Relationships could be:

```
Nimo
 ├── uses ─────────── TypeScript
 ├── uses ─────────── MongoDB
 ├── uses ─────────── Vercel AI SDK
 └── implements ───── Associative Memory

Associative Memory
 ├── inspired_by ──── A-MEM
 ├── inspired_by ──── HippoRAG
 └── uses ─────────── Graph Retrieval
```

This lets Nimo answer a question such as:

> What database did I plan to use for Nimo's memory system?

It does not need to find the original conversation first. It can find the `Nimo` entity, traverse its connected memories, and retrieve the database decision with its evidence.

### 7.2 Link generation

When a new memory is created:

1. Search existing memories by embedding.
2. Search existing memories by shared entities and concepts.
3. Retrieve a small candidate set.
4. Ask the LLM to judge the relationship.
5. Validate the proposed edge.
6. Save the edge with its confidence and evidence.

The LLM should not generate an unrestricted graph. It should select from your predefined relationship types and provide evidence.

Example contract:

```
export interface ProposedMemoryLink {
  targetMemoryId: string;

  relation: MemoryRelation;

  confidence: number;
  weight: number;

  reasoning: string;
  evidenceIds: string[];
}
```

Use thresholds as initial engineering defaults, not scientific constants:

| Link confidence | Action                                                   |
| --------------- | -------------------------------------------------------- |
| 0.90–1.00       | Automatically create if evidence supports it             |
| 0.70–0.89       | Create ordinary associative links with evidence          |
| 0.40–0.69       | Keep as a candidate or use only as a weak retrieval hint |
| Below 0.40      | Do not create                                            |

Contradiction, supersession, and identity-merge decisions should have stricter evidence requirements than ordinary `related_to` links.

### 7.3 Avoid graph pollution

A common mistake is connecting everything to everything.

If every memory is linked to every other vaguely similar memory, graph traversal becomes noisy and useless.

Use these rules:

- Limit the number of new links per memory.
- Require a meaningful relationship, not just shared vocabulary.
- Keep edge direction where the relationship is directional.
- Store evidence for important edges.
- Remove or downgrade links when their underlying memories are superseded or deleted.
- Do not increase edge weights merely because a node has been retrieved many times.

A-MEM provides a strong research basis for dynamic note linking and evolution, while HippoRAG supports using graph structure during retrieval. Neither means that unrestricted graph growth is desirable.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://proceedings.neurips.cc\&sz=32)

NeurIPS Proceedings+1



## 8. Associative retrieval: how Nimo remembers

This is the most important runtime component.

A user should not have to say:

> Search session 8392 from last Tuesday.

They should simply ask a question.

Nimo should translate the question into retrieval cues, activate relevant nodes, traverse their relationships, and return evidence-backed context.

### 8.1 Hybrid retrieval

Use four retrieval channels:

| Channel       | What it finds                                        |
| ------------- | ---------------------------------------------------- |
| Vector search | Similar meaning, even when wording differs           |
| Keyword/BM25  | Exact names, terminology, error messages             |
| Entity search | Memories about Nimo, MongoDB, a person, or a project |
| Graph search  | Related memories, decisions, causes, dependencies    |

Each channel produces a ranked list of candidates.

Combine the lists using Reciprocal Rank Fusion (RRF):

\\[ RRF(d)=\sum\_{i=1}^{n}\frac{1}{k+rank_i(d)} \\]

Here, `d` is a memory, `rank_i` is its rank in a search channel, and `k` is a smoothing constant. Start with `k = 60` and tune it through evaluation.

This avoids making raw vector scores and BM25 scores directly comparable when their scales differ.

### 8.2 Spreading activation

Once the initial memories are found, spread activation through their graph connections.

Conceptually:

\\[ A(v)=S(v,q)+\lambda\sum\_{u\rightarrow v}w\_{uv}A(u) \\]

Where:

- \\(A(v)\\) = activation of memory node \\(v\\).
- \\(S(v,q)\\) = relevance to the user's query.
- \\(w\_{uv}\\) = strength of the relationship.
- \\(\lambda\\) = influence of neighboring memories.

Use a bounded number of graph hops, such as two initially. Apply a decay factor per hop and prevent repeated visits from creating runaway activation.

For implementation, this can be a bounded graph expansion rather than a literal simulation of neurons.

### 8.3 Final ranking

After combining search and graph results, rank memories using multiple signals:

\\[ Score(m)= w_rR+ w_gG+ w_tT+ w_iI+ w_cC \\]

Where:

- \\(R\\): hybrid retrieval relevance.
- \\(G\\): graph activation.
- \\(T\\): temporal relevance.
- \\(I\\): importance.
- \\(C\\): confidence and evidence quality.

The weights should be calibrated with a test dataset. Do not assume one set of weights will be correct for all queries.

Also apply hard filters before ranking:

- Owner and workspace access.
- Memory visibility.
- Active status.
- Validity interval.
- Governance restrictions.

A memory with high semantic similarity must never bypass access control.

### 8.4 Retrieval interface

`domain/memory-retrieval.types.ts`

```
export interface RecallInput {
  ownerId: string;

  query: string;

  conversationId?: string;

  limit?: number;
  maxGraphHops?: number;

  memoryTypes?: MemoryType[];

  includeEvidence?: boolean;
}

export interface RetrievedMemory {
  memory: MemoryNode;

  score: number;

  matchedBy: (
    | "vector"
    | "keyword"
    | "entity"
    | "graph"
  )[];

  relatedMemoryIds: string[];

  evidence: MemoryEvidence[];
}

export interface RecallResult {
  memories: RetrievedMemory[];

  totalCandidates: number;

  queryConcepts: string[];

  retrievalTimeMs: number;
}
```

### 8.5 Retrieval algorithm

```
export async function recallMemories(
  input: RecallInput,
): Promise<RecallResult> {
  const queryEmbedding = await embed(input.query);

  const [vectorResults, keywordResults, entityResults] =
    await Promise.all([
      searchByVector(input, queryEmbedding),
      searchByKeyword(input),
      searchByEntity(input),
    ]);

  const candidates = reciprocalRankFusion([
    vectorResults,
    keywordResults,
    entityResults,
  ]);

  const expanded = await expandMemoryGraph({
    ownerId: input.ownerId,
    seeds: candidates,
    maxHops: input.maxGraphHops ?? 2,
  });

  const ranked = rankMemories({
    query: input.query,
    candidates: expanded,
  });

  const authorized = await applyRetrievalPolicy({
    ownerId: input.ownerId,
    memories: ranked,
  });

  return assembleRecallResult(
    authorized.slice(0, input.limit ?? 10),
  );
}
```

The functions above are architectural contracts, not complete drop-in implementations. In particular, `applyRetrievalPolicy` must enforce access control in the database query itself, not just after untrusted results have been returned.

### 8.6 Example: cross-conversation retrieval

Imagine these experiences:

- Conversation A: You decide to use MongoDB for Nimo.
- Conversation B: You discuss Atlas Vector Search.
- Conversation C: You design Nimo's memory graph.
- Conversation D: You ask how to retrieve a user's previous architectural decisions.

Now the query is:

> How should Nimo remember its previous architectural decisions?

PAME can activate:

1. The `Nimo` project entity.
2. The `decision` memory type.
3. The MongoDB technology node.
4. The associative memory architecture node.
5. The original evidence supporting each decision.

It then supplies the relevant memories to the agent.

The original conversations may be completely unrelated in their session structure. That does not matter.

## 9. Memory consolidation and evolution

Memory should not be immutable, but it should not change unpredictably either.

Consider this sequence:

1. User says: "I'm considering PostgreSQL for Nimo."
2. Nimo records a candidate decision.
3. Later, user says: "I've decided to use MongoDB."
4. Nimo records a new explicit decision.
5. The earlier candidate is marked superseded or retained as a historical consideration.

It should not delete the old statement and pretend it never happened.

### 9.1 Version-aware memory

I recommend adding a memory version history:

```
export interface MemoryRevision {
  id: string;
  memoryId: string;

  previousContent?: string;
  newContent: string;

  reason:
    | "new_evidence"
    | "user_correction"
    | "consolidation"
    | "supersession";

  evidenceIds: string[];

  createdAt: Date;
}
```

Store revisions in a separate `memory_revisions` collection.

This makes it possible to answer both:

- "What is the current architecture?"
- "What architecture did I originally consider?"

### 9.2 Consolidation rules

| Situation                       | PAME action                            |
| ------------------------------- | -------------------------------------- |
| Same fact repeated              | Attach new evidence to existing memory |
| Same concept, different wording | Merge if semantically equivalent       |
| New information adds detail     | Update or create a related memory      |
| Explicit correction             | Supersede the old claim                |
| Conflicting claims              | Keep both and flag conflict            |
| Temporary task completed        | Archive or expire if appropriate       |
| New experience changes context  | Re-evaluate related memories           |

Memory evolution should be conservative. A model-generated summary is not new evidence by itself.

## 10. Memory governance operations

Expose memory management as a first-class API, rather than hiding it inside a prompt.

### 10.1 Memory service

`domain/memory.service.ts`

```
export interface MemoryService {
  remember(
    input: IngestExperienceInput,
  ): Promise<IngestionResult>;

  recall(
    input: RecallInput,
  ): Promise<RecallResult>;

  update(
    memoryId: string,
    ownerId: string,
    changes: Partial<MemoryNode>,
  ): Promise<MemoryNode>;

  forget(
    memoryId: string,
    ownerId: string,
  ): Promise<void>;

  forgetByQuery(
    ownerId: string,
    query: string,
  ): Promise<number>;

  getRelated(
    memoryId: string,
    ownerId: string,
  ): Promise<MemoryNode[]>;

  getHistory(
    memoryId: string,
    ownerId: string,
  ): Promise<MemoryRevision[]>;
}
```

Do not expose `Partial<MemoryNode>` directly to untrusted agent tool arguments in production. Use a separate Zod schema with an allowlist of editable fields. The service should control `ownerId`, status, visibility, evidence, and timestamps.

### 10.2 Forgetting is a graph operation

If the user says:

> Forget my old decision to use PostgreSQL.

Nimo should:

1. Find the relevant memory.
2. Confirm the target if multiple memories match.
3. Mark the memory for deletion.
4. Remove its edges.
5. Remove it from vector and keyword indexes.
6. Remove or redact derived summaries that contain the information.
7. Preserve only a non-sensitive audit record of the deletion operation.
8. Verify that subsequent retrieval no longer returns it.

If the user asks to forget a whole topic, Nimo must identify dependent memories, not just delete one matching text snippet.

A deletion operation should also handle raw source records. If a raw message contains other unrelated information, use a defined retention/redaction policy rather than deleting the entire conversation indiscriminately.

MongoDB consistency matters here. If all these collections are changed separately, partial failures can leave orphaned edges or searchable deleted memories. Use transactions where supported, or a deletion job with a durable tombstone and retryable cleanup. Keep deleted memories excluded from all retrieval queries immediately, even while cleanup is running.

### 10.3 Memory-management tools for the agent

AgeMem's approach of exposing memory operations as tools is a useful design direction. Nimo can have its own typed tool set.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://aclanthology.org\&sz=32)

ACL Anthology



```
export const memoryTools = {
  remember: rememberTool,
  recall: recallTool,
  updateMemory: updateMemoryTool,
  forgetMemory: forgetMemoryTool,
  getRelatedMemories: getRelatedMemoriesTool,
  getMemoryHistory: getMemoryHistoryTool,
};
```

The agent should not need to know how MongoDB, embeddings, or graph traversal work. It should call a memory capability and receive a controlled result.

## 11. Integrating PAME into Nimo's agent runtime

PAME should be a separate package. Your agent runtime should depend on its public interface, not on Mongoose models.

### 11.1 Runtime flow

User message

Nimo agent runtime

Identity · Mode · Model · Tool permissions

PAME recall

Find relevant memories using the current message and recent task context.

Context assembly

System instructions + relevant memories + current conversation

Vercel AI SDK

Generate response · Execute authorized tools

Experience capture + ingestion job

Preserve evidence and update long-term memory asynchronously.

### 11.2 The agent should not load the entire graph

This is critical.

Do not send every memory node to the LLM on every turn. That would defeat the purpose of a retrieval system and waste context.

Instead, retrieve a small relevant subset. For example:

- 5–10 high-relevance memories.
- Up to 5 supporting or related memories.
- A compact evidence excerpt where necessary.
- A small amount of recent task context.

Those are initial tuning values, not fixed limits.

### 11.3 Context builder

```
export interface MemoryContext {
  memories: RetrievedMemory[];

  formattedContext: string;

  tokenEstimate: number;
}

export async function buildMemoryContext(
  ownerId: string,
  query: string,
): Promise<MemoryContext> {
  const result = await recallMemories({
    ownerId,
    query,
    limit: 8,
    maxGraphHops: 2,
    includeEvidence: true,
  });

  const formattedContext = result.memories
    .map(({ memory, evidence }) => {
      return [
        `Memory: ${memory.summary}`,
        `Type: ${memory.type}`,
        `Confidence: ${memory.confidence}`,
        `Evidence: ${evidence
          .map((item) => item.quote)
          .filter(Boolean)
          .join("; ")}`,
      ].join("\n");
    })
    .join("\n\n");

  return {
    memories: result.memories,
    formattedContext,
    tokenEstimate: estimateTokens(formattedContext),
  };
}
```

This is a simple first version. Later, the context builder should deduplicate repeated evidence, prioritize direct answers, preserve contradictions, and enforce a token budget.

### 11.4 Connect to your existing system prompt

You already have a `buildSystemPrompt(modelId, mode, memory)` pattern. PAME can provide the `MemoryContext` that is passed into it.

Conceptually:

```
const memoryContext = await buildMemoryContext(
  ownerId,
  userMessage,
);

const systemPrompt = buildSystemPrompt(
  modelId,
  mode,
  memoryContext,
);

const result = await generateText({
  model: config.model,
  system: systemPrompt,
  messages: conversationMessages,
});
```

Do not confuse this with the complete memory implementation. Adding `formattedContext` to a system prompt is the final context-injection step; the actual memory work is the ingestion, persistence, governance, indexing, and retrieval pipeline described above.

### 11.5 API boundaries

I would keep these responsibilities separate:

| Package           | Responsibility                                                 |
| ----------------- | -------------------------------------------------------------- |
| `packages/memory` | Domain types, policies, ingestion, retrieval, graph operations |
| `packages/db`     | MongoDB connection and shared database infrastructure          |
| `packages/agents` | Agent execution, prompt assembly, tool registration            |
| `packages/server` | HTTP routes, authentication, validation, ownership checks      |
| `packages/worker` | Background ingestion, embedding, maintenance                   |

Avoid importing Express or Mongoose into `packages/agents`. Avoid importing agent internals into the memory domain. Use interfaces and dependency injection at the package boundary.

## 12. Memory maintenance and background jobs

PAME needs background maintenance, otherwise its graph and indexes will gradually become stale.

Recommended jobs:

| Job                  | Responsibility                               | Frequency                 |
| -------------------- | -------------------------------------------- | ------------------------- |
| `memory.ingest`      | Process captured experiences                 | Continuously              |
| `memory.embed`       | Generate missing embeddings                  | Continuously              |
| `memory.link`        | Discover new associations                    | After consolidation       |
| `memory.evolve`      | Re-evaluate related memories                 | When new evidence arrives |
| `memory.reconcile`   | Find contradictions and duplicate candidates | Periodically              |
| `memory.expire`      | Archive expired temporary memories           | Daily                     |
| `memory.index-check` | Find stale or missing indexes                | Periodically              |
| `memory.cleanup`     | Complete deletion and cleanup tasks          | Continuously              |

Use a durable queue rather than an in-process `setTimeout`. You are already exploring Redis and background jobs; a Redis-backed queue such as BullMQ is a reasonable option when you introduce a worker package.

For the first prototype, a MongoDB-backed job collection with retry state can work. The important property is durable, retryable processing—not which queue library you choose.

## 13. Implementation stages

Do not implement every feature at once. Build a system that can be tested at every stage.

## PAME implementation roadmap

Stage 1 — Foundation

Build first

Domain interfaces, MongoDB schemas, experience capture, memory repository, owner scoping, basic policy engine.

Deliverable: Nimo can store and retrieve a structured memory safely.

Stage 2 — Memory ingestion

LLM extraction, Zod validation, duplicate detection, confidence, evidence, consolidation.

Deliverable: Nimo can turn useful interactions into structured memories.

Stage 3 — Semantic retrieval

Embeddings, Atlas Vector Search, keyword retrieval, entity matching, hybrid ranking.

Deliverable: Nimo can recall memories without knowing their original conversation.

Stage 4 — Associative graph

Edge generation, relationship validation, graph traversal, activation scoring.

Deliverable: Nimo can connect related memories and perform multi-hop retrieval.

Stage 5 — Governance and evolution

Corrections, supersession, contradictions, version history, forgetting, retention, audit.

Deliverable: Nimo can maintain a changing memory network without silently corrupting it.

Stage 6 — Agent integration

Recall context builder, memory tools, async workers, API integration, permissions.

Deliverable: Nimo uses memory naturally while chatting and executing tasks.

Stage 7 — Evaluation and visualization

Retrieval benchmarks, graph explorer, memory inspector, user controls, operational metrics.

Deliverable: Nimo's memory can be inspected, measured, and improved.

### What I would implement first

For your current Nimo codebase, the first practical milestone should be:

1. `packages/memory` with domain interfaces.
2. `experiences` and `memories` MongoDB collections.
3. `remember()` and `recall()` services.
4. A simple extraction model call with Zod validation.
5. Owner-scoped memory retrieval.
6. A small test suite covering duplicate memories, corrections, and deletion.

Do not start with the visual graph, multi-hop PageRank, automatic memory evolution, or a new graph database. Those are later capabilities.

## 14. How to know whether PAME actually works

A memory system can look impressive in a graph visualization and still retrieve the wrong information.

You need a benchmark before adding sophisticated graph behavior.

Build a test dataset containing questions whose answers are known from stored experiences.

### Retrieval test categories

| Test                      | Example                                                         |
| ------------------------- | --------------------------------------------------------------- |
| Direct recall             | Which database did I choose?                                    |
| Cross-conversation recall | What did I say about the database several conversations ago?    |
| Semantic recall           | What framework powers my agent execution?                       |
| Multi-hop recall          | Which technologies did I choose for Nimo's memory architecture? |
| Temporal recall           | What did I originally consider before making the decision?      |
| Contradiction handling    | What are the conflicting database decisions?                    |
| Correction handling       | Which version is the current decision?                          |
| Negative recall           | Did I ever actually choose PostgreSQL?                          |
| Forgetting                | Can a deleted memory still be retrieved?                        |
| Isolation                 | Can one user retrieve another user's memories?                  |

### Metrics to measure

- Recall\@K: Did the correct memory appear among the top K results?
- Precision\@K: How many retrieved memories were actually relevant?
- MRR: How highly did the first correct result rank?
- Faithfulness: Does the answer accurately reflect the evidence?
- Contradiction accuracy: Does Nimo recognize conflicting claims?
- Deletion success: Can deleted information still be retrieved?
- Latency: How long does retrieval take?
- Cost: How much embedding and LLM processing does memory maintenance consume?

Compare at least three configurations:

1. Vector-only retrieval.
2. Vector + keyword + entity retrieval.
3. Hybrid retrieval + graph expansion.

If the graph doesn't improve multi-hop recall or answer quality enough to justify its latency and complexity, don't use it for every query.

## 15. Security and production considerations

Before exposing this to multiple users, implement:

- Owner and workspace filtering in every repository query.
- Authorization checks before graph traversal.
- Strict separation of private and shared memories.
- Input and output validation for all LLM-generated memory operations.
- Encryption and access controls for sensitive stored information.
- Rate limits on memory extraction and graph evolution.
- Retry-safe ingestion and idempotent writes.
- Deletion propagation across source records, derived memories, embeddings, and caches.
- Monitoring for failed jobs, stale indexes, and orphaned edges.

Treat stored memories as untrusted input. A memory may contain malicious instructions quoted from an external document or tool result. It must never override Nimo's system instructions or security policies simply because it was retrieved.

## 16. Recommended final technology choices

For Nimo's current architecture, I would use:

| Component       | Recommendation                                                |
| --------------- | ------------------------------------------------------------- |
| Language        | TypeScript                                                    |
| Persistence     | MongoDB                                                       |
| ODM             | Mongoose                                                      |
| Semantic search | MongoDB Atlas Vector Search                                   |
| Keyword search  | MongoDB Atlas Search                                          |
| Graph engine    | Application-level TypeScript traversal                        |
| Embeddings      | Pluggable embedding provider                                  |
| Extraction      | Vercel AI SDK                                                 |
| Background jobs | BullMQ + Redis, or a durable MongoDB job collection initially |
| Validation      | Zod                                                           |
| Visualization   | React graph explorer                                          |
| Evaluation      | Custom retrieval benchmark                                    |

Do not introduce Neo4j yet. A dedicated graph database becomes worth considering when graph queries, traversal depth, scale, or operational requirements exceed what your application-level graph implementation can handle.

## 17. What Nimo should ultimately feel like

The end result should be an assistant that can:

- Remember important information without requiring the user to manually save every detail.
- Connect concepts discussed in completely different conversations.
- Understand that different names can refer to the same project or technology.
- Recall the reasoning behind previous decisions, not just their final values.
- Recognize when a previously remembered fact has changed.
- Explain where a memory came from.
- Let the user inspect, correct, and forget memories.
- Use relevant memories automatically without loading its entire history.

And its graph should be a real representation of its stored knowledge—not merely a visual decoration.

## Final architectural decision

PAME = Experience Store + Associative Memory Graph + Hybrid Retrieval + Memory Governance

The core principle

Sessions organize interactions. Memories organize knowledge. Associations connect knowledge. Governance controls what survives.

That is the distinction that makes Nimo's memory independent of conversation boundaries.

### Research reading order

1. [A-MEM — Agentic Memory for LLM Agents (NeurIPS 2025)](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html?utm_source=chatgpt.com) — start here for dynamic memory notes and linking.
2. [HippoRAG (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/6ddc001d07ca4f319af96a3024f6dbd1-Abstract-Conference.html?utm_source=chatgpt.com) — study graph-based associative retrieval.
3. [AgeMem (ACL 2026)](https://aclanthology.org/2026.acl-long.981/?utm_source=chatgpt.com) — study autonomous memory-management operations.

My recommendation: Build PAME in stages 1–3 first, then add the graph in stage 4. The graph is the distinctive feature, but reliable evidence, ownership, persistence, and retrieval are what make it a usable memory system rather than an interesting demo.