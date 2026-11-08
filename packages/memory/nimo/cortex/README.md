# The Cortex

The governing layer. The cortex decides what Nimo is allowed to remember,
change, retrieve, share, and forget. It is the difference between a memory
system and a *trustworthy* memory system.

## Governance rules

1. **Explicit beats inferred.** A user who says "I prefer X" outranks an
   AI guess that the user might prefer X.
2. **Corrections beat old memories.** A correction supersedes — history is
   preserved, never rewritten silently.
3. **Contradictions are retained.** Two conflicting claims are kept. The
   conflict is flagged. Nimo does not arbitrarily choose.
4. **Sensitive data is restricted.** No passwords, API keys, credentials, or
   highly sensitive personal information — ever, in any neuron.
5. **Every neuron has provenance.** Nimo can always explain *why* it
   believes something: the experience, the quote, the timestamp.
6. **Deletion propagates.** Forgetting a neuron removes its synapses,
   embeddings, and index entries. What the user asks Nimo to forget is
   forgotten.
7. **No cross-owner leakage.** Every neuron, synapse, and retrieval is
   scoped to the authenticated owner.

## What goes here

- Policy engine design — what the cortex allows the agent to do on its own
  vs what requires confirmation.
- Forgetting as a graph operation — the full propagation sequence.
- Audit — how Nimo proves it remembered/changed/forgot something, without
  storing secrets in the audit itself.
- Adversarial memory — a retrieved neuron is *untrusted input*. It must
  never be able to override system instructions.
