# Benchmarks

How we know Nimo actually remembers. A memory system can look impressive
in a graph visualization and still retrieve the wrong thing. Numbers, not
vibes.

## Test categories

| Test | Example |
| ---- | ------- |
| Direct recall | "Which database did I choose?" |
| Cross-conversation recall | "What did I say about the database several conversations ago?" |
| Semantic recall | "What framework powers my agent execution?" |
| Multi-hop recall | "Which technologies did I choose for Nimo's memory architecture?" |
| Temporal recall | "What did I originally consider before deciding?" |
| Contradiction handling | "What are the conflicting database decisions?" |
| Correction handling | "Which version is the current decision?" |
| Negative recall | "Did I ever actually choose PostgreSQL?" |
| Forgetting | "Can a deleted memory still be retrieved?" |
| Isolation | "Can one user retrieve another user's memories?" |

## Metrics

- Recall@K, Precision@K, MRR
- Faithfulness (does the answer reflect the evidence?)
- Contradiction accuracy
- Deletion success
- Latency, cost

## The comparison that matters

Three configs, same questions:

1. Vector-only retrieval
2. Vector + keyword + entity
3. Hybrid + graph expansion

If the graph doesn't improve multi-hop recall enough to justify its
latency and complexity, we don't use it for every query. That decision
is made here, with data.
