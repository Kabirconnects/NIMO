# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately. Do not open a public issue, pull request, or discussion for them, since that exposes the problem before a fix is available.

Email the details to [himanshuarodia5@gmail.com](mailto:himanshuarodia5@gmail.com). Include:

- A description of the vulnerability and the impact you believe it has.
- Steps to reproduce it, or a proof of concept if you have one.
- The version or commit you tested against, and your environment (OS, terminal, Bun version).

## What to expect

- You will get an acknowledgement within 3 days.
- We will investigate, keep you updated on progress, and aim to release a fix or mitigation within 90 days for confirmed issues.
- Please give us a reasonable window to ship the fix before disclosing it publicly. We will credit you in the release notes unless you prefer to stay anonymous.

## Scope

Nimo is a local terminal application. Reports are in scope when they affect the CLI in [`packages/cli`](packages/cli) or its dependencies as used by the project, for example:

- Unexpected code execution from input the CLI handles.
- Secrets or credentials leaked through logs, error output, or committed files.
- Dependency vulnerabilities that are exploitable through Nimo's usage.

General bugs, feature requests, and questions belong in [issues](https://github.com/Kabirconnects/Nimo/issues), not here. See [CONTRIBUTING.md](CONTRIBUTING.md) for those.
