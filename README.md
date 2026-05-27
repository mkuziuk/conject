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

Pi integration is isolated behind the runtime interface and is not required for default tests. The Pi SDK is a pinned project dependency, and Conject does not read your normal user-level Pi config. Check project Pi readiness with:

```bash
pnpm cli pi-check
```

Live Pi runs require explicit model settings in `conject.yaml` and the referenced API key in the process environment:

```yaml
runtime:
  pi:
    agentDir: .conject/pi
models:
  default:
    provider: anthropic
    model: claude-sonnet-4-5
    apiKeyEnv: ANTHROPIC_API_KEY
    thinking: medium
```

`runtime.pi.agentDir` must stay under `.conject/`; the runtime uses in-memory Pi auth with `apiKeyEnv` and does not use `~/.pi`.

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
