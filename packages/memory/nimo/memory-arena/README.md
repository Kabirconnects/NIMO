# Memory Arena

Where competing memories meet. The arena is where contradictions live,
where corrections land, and where Nimo decides what to believe when two
memories disagree.

## What goes here

- Contradiction handling — two memories say different things, both are kept,
  the conflict is flagged, and retrieval surfaces both.
- Supersession — a correction arrives. The old memory is *not* deleted. It
  is marked `superseded`, its history is kept, and the new memory points
  back at it. Nimo can always answer "what did we originally think?"
- Merge rules — when two neurons are really the same belief stated twice,
  they merge and evidence accumulates rather than duplicating.
- Arena experiments — which strategy wins when memories collide?

## The rule

Memory evolution is **conservative**. A model-generated summary is not new
evidence. An explicit user correction outranks any inference. Nimo never
rewrites its own past — it adds to it, and the arena records why.
