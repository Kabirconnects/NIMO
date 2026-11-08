# Contributing to Nimo

Thanks for your interest in contributing. Nimo is a terminal UI built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/sst/opentui), and the CLI lives in [`packages/cli`](packages/cli).

## Before you start

For anything larger than a small fix, open an issue first and describe what you want to change. That lets us agree on the approach before you spend time on it.

## Development setup

Nimo requires [Bun](https://bun.sh) 1.3 or newer.

```bash
git clone https://github.com/Kabirconnects/Nimo.git
cd Nimo
bun install
```

Run the CLI in watch mode:

```bash
bun run dev:cli
```

Type `/help` for commands, press enter to send, and `ctrl+c` to exit.

## Making a change

1. Fork the repository and create a branch from `main`:

   ```bash
   git checkout -b your-change
   ```

2. Make your change. Match the style of the surrounding code: TypeScript with strict settings, React components under `packages/cli/src/components`.
3. Typecheck before you commit:

   ```bash
   bun run --filter cli typecheck
   ```

4. Run the CLI and confirm the change behaves as expected.
5. Commit with a short message that says what changed and why. The existing history uses [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(cli): add command history`.
6. Open a pull request against `main`. Describe what changed, why, and how you tested it.

## Guidelines

- Keep each pull request focused on a single change.
- Don't commit secrets. `.env` files are gitignored; start from [`.env.example`](.env.example) when you need local configuration.
- Prefer small, readable changes over clever ones. If a reviewer would have to ask why something works, add a short comment.
- Run the typecheck locally so CI isn't the first place a type error shows up.

## Reporting bugs

Open an issue and include:

- What you expected to happen and what happened instead.
- Steps to reproduce, ideally the shortest sequence that triggers it.
- Your OS, terminal, and Bun version (`bun --version`).

## Security issues

Please don't report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md) for how to report them privately.
