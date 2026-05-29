---
name: conject-implementation-proposal
description: Use after Conject research has been reviewed and ranked to propose what the user should implement next, without editing files until explicitly asked.
---

# Conject Implementation Proposal

Produce a proposal the user can approve or revise.

Include:

- goal;
- ranked rationale;
- minimal implementation or experiment shape;
- validation plan;
- risks and open questions;
- likely files or modules;
- what should not be implemented yet.

Stop at the proposal unless the user explicitly asks to implement. Do not edit implementation files directly after Conject research.

Use `conject_present_proposal` for the final proposal. Pass a concise `summary` for chat visibility and the full proposal as `content`. If the user has asked for implementation, or later gives implementation intent such as "build this", "implement it", "go ahead", or "apply the proposal", call `conject_spawn_builder`.
