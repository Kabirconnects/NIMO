# Synapses

The connections. Not a blob of "related_to" — every synapse has a **type**, a
**direction**, a **weight**, and a **confidence**.

## Relation types

| Synapse | Meaning | Direction? |
| ------- | ------- | ---------- |
| `related_to` | Loosely connected | No |
| `supports` | One memory provides evidence for another | Yes |
| `contradicts` | Two memories disagree — both kept, conflict flagged | Yes |
| `depends_on` | A decision depends on a requirement | Yes |
| `derived_from` | One memory came from another | Yes |
| `supersedes` | A newer memory replaces an older one | Yes |
| `explains` | One memory explains why another exists | Yes |
| `caused_by` | One memory caused another | Yes |
| `part_of` | One memory is part of a larger one | Yes |
| `occurred_before` / `occurred_after` | Temporal order | Yes |
| `about` | One memory is about an entity/concept | Yes |

## Rules

- A generic `related_to` never replaces a specific relation like
  `contradicts` or `supersedes`.
- Not every edge is bidirectional. Direction carries meaning.
- Every important synapse has **evidence** behind it.
- A synapse dies when either endpoint neuron dies. Its weight never
  increases just because the neuron was retrieved often — popularity is not
  truth.
- Limit synapses per neuron. A neuron connected to everything is connected
  to nothing.

## What goes here

- Synapse formation thresholds — when does Nimo decide two neurons are
  connected?
- Weight calibration — how does weight map to retrieval behavior?
- Graph pollution — how do we detect and prune noisy synapses?
- Experiments with traversal — does `contradicts` help recall more than
  `related_to`?
