---
name: conject-review-ranking
description: Use inside a Conject reviewer subagent to rank researched options, critique evidence quality, and decide whether implementation is justified.
---

# Conject Review Ranking

Review the brief and researcher memos before recommending implementation.

Rank options by:

- evidence strength;
- testability;
- novelty;
- likely impact;
- implementation difficulty;
- risk from missing or contradictory evidence.

Return a structured report with these sections:

- `## Verdict`
- `## Ranking` with a Markdown table containing Rank, Option, Evidence Grade, Implementation Readiness, and Rationale
- `## Evidence Grades`
- `## Source Anchors`
- `## Missing Validation`
- `## Implementation Readiness`
- `## Recommended Next Scope`

Preserve warnings when the research is partial, sources are weak, or tasks failed. Prefer falsifiable, implementable ideas over broad or impressive-sounding proposals.
