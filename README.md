# Conject

Conject is a small research-oriented package built on Pi. It does not replace Pi with a custom TUI or hidden workflow engine. It adds a Conject launcher, a minimal system prompt, research tools, and Agent Skills for a visible research workflow.

## Setup

Conject is installed from this source repo. You do not need to install a global `pi` binary first; this package uses the pinned Pi dependency declared in `package.json`.

Before setup, install:

- Git
- Node.js `>=22.19.0`
- npm, which is included with Node.js

Clone Conject once into a separate source/tools directory:

macOS, Linux, or WSL:

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/mkuziuk/conject.git
cd conject
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\Projects"
Set-Location "$HOME\Projects"
git clone https://github.com/mkuziuk/conject.git
Set-Location conject
```

SSH clone URLs also work if your GitHub SSH key is already configured.

Build and link the `conject` launcher. These commands are the same on all platforms:

```bash
npm install
npm run build
npm run link:cli
```

Then leave the Conject source repo and open the project you want to research or build:

macOS, Linux, or WSL:

```bash
cd ~/Projects/<target-project>
conject --doctor
conject
```

Windows PowerShell:

```powershell
Set-Location "$HOME\Projects\<target-project>"
conject --doctor
conject
```

The directory where you run `conject` is the target project. Conject will inspect that project and write visible research artifacts there, for example `research/brief.md`, `research/review.md`, and `research/proposal.md`.

On Windows, use Windows Terminal or WSL for the best Pi TUI behavior.

Typical layout:

```text
~/Projects/conject/          # Conject source checkout
~/Projects/<target-project>/ # Project being researched or built
```

## Isolation

`conject` runs the pinned Pi dependency from this package and isolates Conject state from your normal Pi install:

- `PI_CODING_AGENT_DIR=$HOME/.conject/agent`
- `PI_CODING_AGENT_SESSION_DIR=<target-project>/.conject/sessions`
- `PI_SKIP_VERSION_CHECK=1`

It does not touch `~/.pi/agent`.

Generated state and outputs:

- Conject agent state: `~/.conject/agent`
- Conject credentials: `~/.conject/credentials.env`
- target project sessions: `<target-project>/.conject/sessions`
- target project research artifacts: `<target-project>/research/`

On Windows, `~` means your user profile directory; PowerShell will show equivalent paths with backslashes.

Use `conject --print-env` to see the exact environment.

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

Conject loads these values from the process environment first, then from `~/.conject/credentials.env`. The process environment wins if both are set. Do not put API keys directly in `~/.zshrc`; use the private credential file instead:

```bash
conject credentials init
printf '%s\n' '<your-tavily-key>' | conject credentials set TAVILY_API_KEY --stdin
conject credentials status
```

The credential file is created with `0600` permissions and Conject never prints secret values in status or doctor output.

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
