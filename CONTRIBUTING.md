# Contributing to Nimo

Thanks for your interest in Nimo. Before anything else, one important caveat:

> **Nimo is an experimental, work-in-progress research project.** It is not finished and not
> production-ready. The memory engine and the server work and pass their own tests, but the CLI and
> web UI are still scaffolds, APIs move between commits, and some documented behaviour is deliberately
> partial. Please read [note.md](note.md) and the [README](README.md) before contributing.

Because the project is incomplete, expect:

- breaking changes without a deprecation cycle;
- unfinished or stubbed UI surfaces;
- benchmark and status claims that are **self-authored regression evidence**, not independent proof;
- a fast-moving `main` branch.

## Before you start

Open an issue first for anything larger than a small fix. Describe what you want to change and why, so
the approach can be agreed on before you spend time on it. Small typo/docs fixes can go straight to a
pull request.

Good places to help right now:

- the memory engine (`packages/memory`) — retrieval, consolidation, conflict handling, governance;
- the agent tool layer (`packages/agents/src/tools`);
- wiring the CLI (`apps/cli`) and web app (`apps/web`) to the server API;
- tests, benchmarks, and documentation accuracy.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | `>=20.9.0` | Everything |
| pnpm | `11.25.0` | Workspace install and scripts |
| Bun | `>=1.3.0` | The CLI (`apps/cli`) only |

The authoritative versions are in the root `package.json` (`engines`, `packageManager`).

## Development setup

This is a pnpm + Turborepo monorepo. Install from the repository root:

```bash
git clone https://github.com/Kabirconnects/Nimo.git
cd Nimo
pnpm install
```

Common root scripts:

```bash
pnpm build      # turbo build
pnpm dev        # turbo dev
pnpm lint       # turbo lint
pnpm typecheck  # turbo typecheck
pnpm format     # prettier
```

### Running the apps

```bash
# Server (the working entrypoint) — http://127.0.0.1:4000
pnpm --filter @workspace/server dev

# CLI (OpenTUI, run with Bun)
pnpm --filter @workspace/cli dev

# Web app (Vite + React)
pnpm --filter web dev
```

> The CLI renders its UI shell, but the send path is not fully wired to `runAgent()` yet. The web app
> is also still being connected to the server. Please do not treat missing UI wiring as a regression.

### Server configuration

The server is an Express API that wraps `runAgent()`. Configuration lives in `apps/server/.env`, which
is gitignored. Start from the example:

```bash
cp apps/server/.env.example apps/server/.env
```

At minimum the server expects a `JWT_SECRET` of at least 32 characters and an `AI_MODEL` from
`packages/agents/src/models/registry.ts`, plus the API key for whichever provider you use. See
`apps/server/src/lib/env.ts` for the validated schema and Section 10.3 of the README for the full
variable list.

### Memory store

Nimo stores memory in SQLite (default `~/.nimo/pame.db`). For local experiments, point it somewhere
disposable so you never touch a real store:

```bash
AGENT_WORKSPACE=.tmp/nimo-test \
PAME_DB_PATH=.tmp/nimo-test/pame.db \
pnpm --filter @workspace/server dev
```

Never commit `*.db`, `*.sqlite*`, or anything under `~/.nimo`.

## Tests

Memory tests live in `packages/memory` and use isolated temporary databases. They must never touch the
real `~/.nimo/pame.db`.

```bash
# All memory suites (AGI, Dreamer, Formula, Capture, Evolution, Hardening, retrieval benchmark)
pnpm --filter @workspace/memory test:all

# Universal 6-axis suite
pnpm --filter @workspace/memory test:universal

# Individual suites
pnpm --filter @workspace/memory test
pnpm --filter @workspace/memory test:dreamer
pnpm --filter @workspace/memory test:formula
pnpm --filter @workspace/memory test:capture
pnpm --filter @workspace/memory test:evolve
pnpm --filter @workspace/memory test:hardening
pnpm --filter @workspace/memory test:benchmark
```

Also run the workspace typecheck before opening a pull request:

```bash
pnpm typecheck
```

## Making a change

1. Fork the repository and create a branch from `main`:

   ```bash
   git checkout -b your-change
   ```

2. Make your change. Match the style of the surrounding code: strict TypeScript, Prettier formatting,
   and the existing module boundaries. The memory package keeps `domain/`, `storage/`, `retrieval/`,
   `ingestion/`, `graph/`, `skills/`, `governance/`, and `workers/` separate on purpose — do not collapse
   those boundaries without discussing it first.

3. Add or update tests when behaviour changes. Do not weaken an existing assertion to make a change pass;
   explain the behaviour change in the pull request instead.

4. Typecheck and run the relevant suites:

   ```bash
   pnpm typecheck
   pnpm --filter @workspace/memory test:all
   ```

5. Commit with a short message that says what changed and why. The project uses
   [Conventional Commits](https://www.conventionalcommits.org/), for example
   `feat(memory): preserve contradiction edges on merge`.

6. Open a pull request against `main`. Describe what changed, why, how you tested it, and any known
   limitations or follow-up work.

## Guidelines

- Keep each pull request focused on a single change.
- Do not commit secrets. `.env*` is gitignored except `.env.example`; never add real keys or tokens.
- Preserve the project's stated invariants — read-only recall, host-supplied identity, governed deletion,
  secret blocking — unless the pull request is specifically about changing them and explains why.
- Do not present synthetic benchmark results as independent or state-of-the-art evidence. If you add
  numbers, say how the corpus was produced.
- Prefer small, readable changes over clever ones. If a reviewer would have to ask why something works,
  add a short comment.
- Documentation should stay honest about what is finished and what is not. "Experimental" is not a bug
  to paper over.

## Reporting bugs

Open an issue and include:

- what you expected to happen and what happened instead;
- steps to reproduce, ideally the shortest sequence that triggers it;
- your OS, Node, pnpm, and (if relevant) Bun versions;
- whether a custom `PAME_DB_PATH` / `AGENT_WORKSPACE` was in use.

## Security issues

Please do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md) for how
to report them privately.

Also remember the project's own trust boundary: the tool sandbox blocks path traversal, secret reads, and
shell injection, but it is **not a virtual machine**. Workspace code, package scripts, and foundry tools
run with process privileges. Do not run the agent against an untrusted repository.

## License and contributions

Nimo is currently released under a **provisional proprietary/evaluation license** — see [LICENSE](LICENSE).
It is not open source today, and no commercial use, copying, distribution, or resale is granted.

**The plan is to relicense the project under the MIT License once it is finished.** Until that change is
actually committed, the current license terms apply. By submitting a contribution you agree that your
contribution may be included in the project and relicensed under MIT at that point. If that is not
acceptable to you, please do not submit code.
