# Conject

Local TypeScript-first research harness for generating ranked, evidence-backed hypotheses from open-ended prompts.

Start with:

```bash
pnpm install
pnpm cli init
pnpm cli new "Find implementable ideas for robust IMF in hyperspectral unmixing"
pnpm cli run <run-id>
pnpm cli rank <run-id>
pnpm cli export <run-id>
```

You can force a runtime for the research pipeline:

```bash
pnpm cli run <run-id> --runtime mock
pnpm cli run <run-id> --runtime pi
```

The default run path uses a deterministic mock Researcher. To use configured paper/web providers for evidence collection:

```bash
TAVILY_API_KEY="..." pnpm cli run <run-id> --real-research
```

Pi integration is isolated behind the runtime interface and is not required for default tests. The Pi SDK is a pinned project dependency, and Conject does not read your normal user-level Codex or Pi config. Check project Pi readiness with:

```bash
pnpm cli pi status
pnpm cli pi-check
```

The default Pi model config uses OpenAI Codex OAuth through Conject-owned project storage:

```yaml
runtime:
  pi:
    agentDir: .conject/pi
models:
  default:
    provider: openai-codex
    model: gpt-5.5
    thinking: xhigh
    auth:
      type: openai-codex
      storagePath: .conject/pi/auth.json
```

Run this once to create `.conject/pi/auth.json`:

```bash
pnpm cli pi login
```

If the browser callback cannot complete, use the explicit paste-code fallback:

```bash
pnpm cli pi login --manual
```

`runtime.pi.agentDir` and `models.default.auth.storagePath` must stay under `.conject/`; the runtime passes that project-local auth store to Pi and does not use `~/.codex` or `~/.pi`.

API-key providers are still supported:

```yaml
models:
  default:
    provider: anthropic
    model: claude-sonnet-4-5
    thinking: medium
    auth:
      type: apiKeyEnv
      env: ANTHROPIC_API_KEY
```

Builder defaults to deterministic scaffold materialization:

```bash
pnpm cli implement <run-id> <hypothesis-id>
```

The Builder can also go through the runtime interface:

```bash
pnpm cli implement <run-id> <hypothesis-id> --runtime mock
pnpm cli implement <run-id> <hypothesis-id> --runtime pi
```

The tool-backed Researcher normalizes abstracts/snippets into source-linked claims, adds simple support/confidence labels, and records source quality notes. These heuristics are deterministic and intended as the pre-Pi baseline.

Provider smoke tests:

```bash
pnpm cli search "robust hyperspectral unmixing" --type paper --limit 2
pnpm cli search "robust hyperspectral unmixing" --type web --limit 2
```

Paper search uses OpenAlex first and works without a key. Semantic Scholar can use `SEMANTIC_SCHOLAR_API_KEY` when present. Web search needs either `TAVILY_API_KEY` or a configured `providers.web.searxng.baseUrl` in `conject.yaml`.

SearXNG is optional. It is not another API key; it is a self-hosted metasearch server URL. Since Tavily is configured through `TAVILY_API_KEY`, you can leave `providers.web.searxng.enabled: false`.
