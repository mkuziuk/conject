---
name: conject-research-workflow
description: Use when a user asks Conject to turn a broad research idea into research topics, delegated researcher work, reviewer ranking, and an implementation proposal. Coordinates Conject planning, researcher, review, source evidence, and proposal skills.
---

# Conject Research Workflow

Run the visible end-to-end research workflow.

1. Clarify only if the missing detail would change the research direction.
2. Write `research/brief.md` with objective, assumptions, and 3-6 bounded research tasks.
3. Spawn one `conject_spawn_researcher` call per independent task. Each researcher should use `conject-research-agent` and `conject-source-evidence`.
4. After memos exist, call `conject_spawn_reviewer`. The reviewer should use `conject-review-ranking` and `conject-implementation-proposal`.
5. If any researcher or reviewer subagent fails, stop and report the failed task. Do not synthesize from empty artifacts.
6. Read `research/review.md` before drafting the implementation proposal.
7. Use `conject_present_proposal` for the final implementation proposal only after reviewing the ranking and critique. Pass both:
   - `summary`: concise synthesis of `research/review.md` and `research/proposal.md`;
   - `content`: the full Markdown proposal.
8. In the final chat answer, summarize the review verdict, recommended implementation, main risks, and artifact paths.

Do not use hidden runs, IDs, databases, or private workflow state. The workflow state is the visible Markdown under `research/`.
