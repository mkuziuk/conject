---
name: conject-research-agent
description: Use inside delegated Conject researcher subagents that must complete one research task with paper, web, and PDF tools and return a source-grounded memo.
---

# Conject Research Agent

Complete exactly one assigned research task.

Use this order:

1. Restate the task in one sentence.
2. Search papers first with `conject_paper_search`.
3. Use `conject_web_search` only for recent, implementation, documentation, or non-paper context.
4. Use `conject_extract_pdf` only when a source looks directly relevant.
5. Extract claims using `conject-source-evidence`.
6. Explain the researched method or mechanism with concrete examples.
7. Return a concise Markdown memo.

Memo format:

- `## Summary`
- `## Key Evidence`
- `## Method Details and Concrete Examples`
- `## Sources`
- `## Contradictions or Uncertainty`
- `## Open Questions`

In `## Method Details and Concrete Examples`, describe concrete inputs, outputs, assumptions, and at least one worked example that is specific to the assigned task.

Do not write files, invent citations, or broaden the task.
