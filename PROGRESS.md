# Conject Implementation Progress

## Status

Milestone 0-4 style CLI flow is implemented and verified with the mock pipeline. Pi runtime integration is project-owned and no longer depends on user-level Codex or Pi config. OpenAI Codex OAuth auth is configured through `models.*.auth` and defaults to Conject-owned global storage at `~/.conject/auth/auth.json`.

## Completed

- Replaced `PLAN.md` with the refined decision-complete MVP plan.
- Added root workspace files: `package.json`, `pnpm-workspace.yaml`, TypeScript configs, Vitest config, `.gitignore`, and `README.md`.
- Created the initial monorepo directory skeleton.
- Added package manifests and TypeScript sources for artifacts, config, storage, runtime, core, export, tools, agents, and CLI.
- Added zod artifact/config schemas, SQLite storage, configurable scoring, mock agent runtime, orchestrator, Markdown export, and implementation-pack materialization.
- Added Commander CLI commands: `init`, `new`, `run`, `status`, `list`, `open`, `rank`, `export`, and `implement`.
- Added fixtures and tests for schemas, config, scoring, and the full mock pipeline.
- Installed dependencies with `pnpm` and verified `pnpm build` and `pnpm test`.
- Smoke-tested CLI flow in `/private/tmp/conject-smoke.GB19DY` using the Node binary that built native dependencies.
- Added real provider interfaces for OpenAlex, Semantic Scholar, arXiv, Tavily, and SearXNG.
- Added `conject search "<query>" --type paper|web` for provider smoke tests.
- Added mocked provider tests and verified live no-key OpenAlex search.
- Verified live Tavily web search with `TAVILY_API_KEY` from the process environment.
- Added `conject run <run-id> --real-research`, which keeps Strategist/Reviewer mock-backed but uses configured paper/web providers for Researcher evidence bundles.
- Added tool-call persistence and status display for provider calls.
- Verified a live `--real-research` run with OpenAlex and Tavily.
- Added deterministic evidence extraction: source text normalization, source-linked claims, support/confidence heuristics, and source quality notes.
- Verified a live `--real-research` run stores extracted claims and quality notes.
- Added structured agent profiles for Strategist, Researcher, Reviewer, and Builder.
- Added a pinned `@earendil-works/pi-coding-agent` dependency.
- Added a Conject-owned Pi SDK runtime adapter with strict JSON artifact parsing, zod validation, and one retry after validation failure.
- Removed normal runtime fallback to global/user-level Pi configuration.
- Added explicit Pi provider/model/auth validation and `.conject/`-scoped Pi agentDir enforcement.
- Added `conject pi-check` to validate project Pi runtime readiness.
- Added the `models.*.auth` shape for config-owned credentials, with OpenAI Codex OAuth defaulting to global Conject auth storage at `~/.conject/auth/auth.json` and legacy `apiKeyEnv` compatibility.
- Added `conject auth login`, `conject auth logout`, and `conject auth status` commands; `conject pi ...` remains a compatibility alias.
- Adjusted browser login so the paste-code prompt only appears with `--manual`; normal login waits for the browser callback and exits after storing credentials.
- Rebranded user-facing auth to Conject auth, including status/login/logout messages and docs.
- Added the first Ink TUI: plain `conject` opens a run dashboard and command cockpit.
- Added `pnpm link:cli` for local development installs of the `conject` terminal command.
- Added `conject run <run-id> --runtime mock|pi` for explicit pipeline runtime selection.
- Extended implementation packs with optional `files[]` content, safe materialization under `implementations/`, and path traversal checks.
- Added `conject implement <run-id> <hypothesis-id> --runtime mock|pi` so Builder can run through the runtime interface before pack materialization.
- Added tests for Pi prompt/profile wiring and implementation pack materialization.

## Current

- Mock/offline MVP path is working through ranked hypotheses, Markdown export, and implementation pack scaffolding.
- Opt-in tool-backed Researcher path is working with provider calls and persisted tool-call logs.
- Evidence bundles now contain deterministic source-linked claims instead of raw abstract/snippet summaries only.
- `pnpm cli pi-check` now validates `models.default.provider`, `models.default.model`, and `models.default.auth`; for OpenAI Codex it fails early until `pnpm cli auth login` creates Conject auth credentials.
- Runtime-backed Builder packs can be materialized when the runtime produces an `implementation_pack`.

## Remaining

- Run a live Pi Strategist/Reviewer/Builder smoke after Conject global auth is verified.
- Add Pi-assisted Reviewer/Researcher reasoning on top of deterministic extracted evidence.
- Expose paper/web provider adapters as Pi custom tools if we want Pi-driven search instead of deterministic tool-backed Researcher search.
- Make scoped Pi Builder the default path once live Pi output quality is verified.
- Expand the Ink TUI with richer artifact browsing and direct file opening.

## API Keys

- OpenAlex: no key required; optional `providers.paper.openAlex.mailto`.
- arXiv: no key required.
- Semantic Scholar: optional `SEMANTIC_SCHOLAR_API_KEY`.
- Tavily: required for hosted web search via `TAVILY_API_KEY`.
- SearXNG: no key, but requires `providers.web.searxng.baseUrl`.
- Pi model provider: required only for `--runtime pi`; default config uses `models.default.auth.type: openai-codex` and requires `pnpm cli auth login`. API-key providers can use `models.default.auth.type: apiKeyEnv`.
