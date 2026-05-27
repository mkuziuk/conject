# Conject MVP Plan

## Summary

Conject is a local TypeScript-first agentic research harness. It turns an open-ended research prompt into ranked, evidence-backed, implementation-ready hypotheses.

The MVP flow is:

```text
user prompt
  -> Strategist
  -> Researcher jobs
  -> Reviewer
  -> ranked hypothesis cards
  -> Builder
  -> implementation pack
```

The system is artifact-first, not chat-first. Agents communicate through durable typed JSON artifacts, with Markdown export for human review.

## Core Decisions

- Main language: TypeScript.
- Runtime: Node.js `>=22.19.0`.
- Package manager: `pnpm`.
- CLI framework: Commander.
- Schema validation: zod.
- Tests: vitest.
- Storage: SQLite with `better-sqlite3` and Kysely.
- TUI: Ink later; CLI and Markdown export first.
- Python: execution/helper language only, managed with `uv` first and documented `venv`/`pip` fallback.
- Runtime state: ignored `.conject/`.
- Project config: committed root `conject.yaml`.
- Exports: `exports/<run-id>/`.
- Builder output: `implementations/<run-id>/<hypothesis-id>/`.

## Agent Architecture

Use exactly four logical agents for MVP:

- Strategist: normalizes the objective and creates candidate ideas.
- Researcher: collects evidence for each idea.
- Reviewer: converts ideas and evidence into ranked hypothesis cards.
- Builder: creates an implementation plan and runnable scaffold for a selected hypothesis.

Every agent has a structured profile:

```ts
type AgentProfile = {
  id: string;
  role: string;
  model: ModelConfig;
  systemPrompt: string;
  skills: SkillRef[];
  tools: ToolRef[];
  inputArtifacts: ArtifactType[];
  outputArtifacts: ArtifactType[];
  permissions: PermissionPolicy;
  budget: BudgetPolicy;
  outputSchema: unknown;
};
```

Agent outputs must be strict schema-shaped JSON. Validate with zod, retry once with validation errors, then fail the job.

## Runtime

Define `AgentRuntime` before real model integration.

```ts
interface AgentRuntime {
  runAgentJob(input: RunAgentJobInput): Promise<RunAgentJobResult>;
}
```

Implement:

- `MockAgentRuntime`: deterministic, default for tests/offline demos.
- `PiAgentRuntime`: uses the pinned `@earendil-works/pi-coding-agent` SDK in-process, with Conject-owned auth/model/session config, explicit tool allowlists, custom tools, run-scoped sessions, event subscription, and structured output validation.

Milestone 3 must prove the full Strategist -> Researcher -> Reviewer pipeline through Pi. Builder becomes real later.

## Config

Add `conject init`, a small wizard that writes commented `conject.yaml`.

Config includes:

- research preset: `quick`, `balanced`, or `deep`;
- idea/source limits;
- web query/fetch limits;
- paper and web providers;
- model default plus per-agent overrides;
- model auth from either environment variables or project-local OpenAI Codex OAuth storage;
- scoring weights;
- advanced per-agent budgets.

Secrets are never committed by default. Credentials come from environment variables referenced by `conject.yaml` or project-local OAuth storage declared in `models.*.auth`. Pi runtime state and auth storage stay under `.conject/` and must not read normal user-level Codex or Pi config. Each run snapshots the effective config for reproducibility.

Default Pi auth uses OpenAI Codex OAuth:

```yaml
models:
  default:
    provider: openai-codex
    model: gpt-5.5
    thinking: xhigh
    auth:
      type: openai-codex
      storagePath: .conject/pi/auth.json
```

Default presets:

```text
quick:    3 ideas, 2 sources per idea
balanced: 5 ideas, 3 sources per idea
deep:     8 ideas, 5 sources per idea
```

## Research Tooling

Paper search order:

```text
OpenAlex primary -> Semantic Scholar/arXiv enrichers or fallbacks
```

Web search:

```text
Tavily hosted adapter first
SearxNG self-hosted adapter second
```

If web search is enabled but unconfigured, warn and continue with paper/OA research.

Researcher may use:

- paper APIs;
- OA PDF URLs returned by paper metadata;
- capped selected web search result fetches.

OA PDFs are parsed best-effort by a Python `pypdf` worker. If parsing fails, fall back to metadata and abstract text.

Researcher jobs run with bounded parallelism of 2 by default. If one Researcher job fails, continue with warnings and mark the ranking partial.

## CLI

Implement commands:

```bash
conject init
conject new "<prompt>"
conject run <run-id>
conject status <run-id>
conject list
conject open <run-id> <artifact-id>
conject rank <run-id>
conject implement <run-id> <hypothesis-id>
conject export <run-id> --format markdown
conject pi login
conject pi logout
conject pi status
```

`conject run <run-id>` executes through ranking only. Builder runs only through `conject implement`.

Commands use explicit run IDs for mutating and artifact-specific operations. Reruns resume by default and skip succeeded jobs unless forced.

## Data Model

Use a small SQLite schema:

- `runs`
- `jobs`
- `artifacts`
- `events`
- `tool_calls`

Most structured data may live in JSON columns for MVP. Store full local raw logs, Pi text, tool I/O, and parser errors under ignored `.conject/`.

Use internal ULIDs for persistence and readable run-scoped domain IDs such as `IDEA-001` and `HYP-003` for CLI UX.

## Scoring

Use configurable weighted scoring with these defaults:

```text
finalScore =
  0.25 * impactScore
+ 0.25 * testabilityScore
+ 0.20 * evidenceStrengthScore
+ 0.15 * noveltyScore
- 0.15 * implementationDifficultyScore
```

Scores are normalized to a 1-5 scale. Store Reviewer explanations; never show only numbers.

## Builder

Builder default permissions:

- read project context and Conject artifacts;
- write only inside `implementations/<run-id>/<hypothesis-id>/`;
- run sandboxed commands only there;
- no network by default.

Builder generates:

- README;
- implementation plan Markdown;
- `pyproject.toml`;
- source stub;
- pytest smoke test;
- validation commands in the `ImplementationPack`.

## Milestones

### Milestone 0-1: Repo, Config, Schemas

- Scaffold pnpm monorepo.
- Add CLI package shell.
- Add `conject init`.
- Add root config schema and example YAML.
- Add zod schemas for all major artifact and state types.
- Add fixtures and schema tests.

### Milestone 2: Storage and CLI Shell

- Implement SQLite/Kysely storage.
- Create `.conject/` state layout.
- Snapshot effective config per run.
- Implement `new`, `list`, `status`, and `open`.

### Milestone 3: Mock and Pi Research Pipeline

- Implement orchestrator with `MockAgentRuntime`.
- Implement `PiAgentRuntime` for Strategist, Researcher, and Reviewer.
- Implement paper/web tool interfaces and logging.
- Ensure full research-to-ranking pipeline works with mock and Pi.

### Milestone 4: Ranking and Export

- Implement configurable scoring.
- Implement partial-ranking warnings.
- Implement `rank` and Markdown export.

### Milestone 5: Builder Packs

- Implement scoped Pi Builder.
- Generate runnable implementation packs under `implementations/`.

### Milestone 6: Ink TUI

- Build dashboard screens for existing runs, jobs, rankings, artifacts, and implementation triggers.

## Testing

Default tests must not require API keys or live network.

Test layers:

- unit: schemas, config validation, IDs, scoring, permissions;
- storage: migrations, run/artifact/job/event persistence;
- orchestrator: mock pipeline, failed Researcher continuation, resume behavior, strict JSON retry;
- export: Markdown structure and files;
- integration: Pi and live providers gated behind env vars.

## MVP Done

The MVP is done when:

1. A user can initialize config.
2. A user can create a research run from a prompt.
3. The system produces ideas, evidence bundles, ranked hypothesis cards, and a ranking.
4. The user can inspect ranking and hypothesis cards.
5. The user can generate an implementation pack for one hypothesis.
6. All major outputs are persisted as typed artifacts.
7. Markdown export works.
8. Mock runtime remains available and default tests pass without live APIs.
9. Pi integration is isolated behind `AgentRuntime`.
