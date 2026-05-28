# Conject Pi

Conject Pi is a small research-oriented package for Pi. It does not replace Pi with a custom TUI or hidden workflow engine. It adds a Conject launcher, a minimal system prompt, research tools, and Agent Skills for a visible research workflow.

## Install

```bash
npm install
npm run build
npm run link:cli
```

Then run:

```bash
conject-pi --doctor
conject-pi
```

## Isolation

`conject-pi` runs the pinned Pi dependency from this package and isolates Conject state from your normal Pi install:

- `PI_CODING_AGENT_DIR=$HOME/.pi-conject/agent`
- `PI_CODING_AGENT_SESSION_DIR=$PWD/.pi/sessions`
- `PI_SKIP_VERSION_CHECK=1`

It does not touch `~/.pi/agent`.

Use `conject-pi --print-env` to see the exact environment.

## Workflow

Ask naturally, for example:

```text
Research whether we should implement a lightweight paper-ranking workflow for this repo.
```

Conject should:

1. write `research/brief.md`;
2. split the idea into several research topics;
3. call researcher subagents;
4. write memos under `research/agents/`;
5. call a reviewer subagent;
6. write `research/review.md`;
7. write `research/proposal.md`;
8. show a concise summary of the review and proposal plus artifact paths in chat.

There are no Conject run IDs, hidden SQLite databases, or workflow widgets. The visible Markdown files are the state.

## Tools

The extension registers:

- `conject_paper_search`
- `conject_web_search`
- `conject_extract_pdf`
- `conject_write_artifact`
- `conject_present_proposal`
- `conject_spawn_researcher`
- `conject_spawn_reviewer`

Web search is optional. Configure it with one of:

- `TAVILY_API_KEY`
- `SEARXNG_BASE_URL`
- `CONJECT_SEARXNG_URL`

OpenAlex paper search works without a key. Set `OPENALEX_MAILTO` if you want polite-pool OpenAlex requests.

## Skills

Conject ships six Pi skills:

- `conject-research-workflow`
- `conject-research-planning`
- `conject-research-agent`
- `conject-source-evidence`
- `conject-review-ranking`
- `conject-implementation-proposal`

The high-level workflow skill coordinates the lower-level skills. Researcher subagents use `conject-research-agent` and `conject-source-evidence`; the reviewer uses `conject-review-ranking` and `conject-implementation-proposal`.

## Subagents

Subagent prompts live under `subagents/`:

- `researcher.md`
- `reviewer.md`
- `builder.md`

The researcher and reviewer tools read these prompts. After a proposal is shown, reply `build this` to hand the approved proposal to the builder prompt in the normal Pi session.

Subagent rows stream child progress in the TUI. Collapsed rows show status plus the last child tool calls; press Ctrl+O to expand Pi tool output and inspect full child transcripts.

## Thinking

Use `/thinking` to show the current reasoning effort. Use `/thinking off|minimal|low|medium|high|xhigh` to change it.

## Development

```bash
npm run typecheck
npm test
npm run dev -- --doctor
```
