---
name: codex-workflow-orchestrator
description: Automatically classify a user's task, select and chain the appropriate Codex skills, clarify ambiguity, execute the work, verify results, and report changes. Use this when the user wants Codex to choose a complete workflow instead of manually naming skills or pasting templates.
---

# Codex Workflow Orchestrator

Use this skill as a workflow router for multi-step tasks. Do not blindly invoke every skill. First classify the task, then select only the relevant workflow and skills.

## Core flow

1. Identify the task type, desired outcome, available files, constraints, and success criteria.
2. If the request is ambiguous, high-risk, or contains competing goals, use `grilling` to challenge assumptions and expose missing decisions. Ask focused questions rather than interrogating the user about details that do not affect the result.
3. Use `brainstorming` when multiple approaches or creative decisions need comparison. If a reasonable assumption is safe, state it and continue.
4. Use `context-engineering` to complete missing role, background, inputs, constraints, output format, and acceptance criteria.
5. Use `writing-for-agents` to turn the request into explicit, ordered, executable steps.
6. Select one or more workflows from the routing table below.
7. Execute with existing project conventions and keep changes scoped.
8. Validate the result with the relevant tests, checks, rendering, or source review.
9. Report what changed, what was verified, remaining risks, and any next action.

## Routing table

### Prompt optimization

`grilling` when the request is unclear or contentious -> `context-engineering` -> `writing-for-agents` -> `brainstorming` when alternatives remain -> `verification-before-completion`

### New software feature

`grilling` when scope or acceptance criteria are unclear -> `learn-codebase` -> `brainstorming` -> `make-plan` -> `context-engineering` -> `test-driven-development` -> `coding-standards` -> implementation -> `verification-before-completion` -> `requesting-code-review`

### Bug investigation

`grilling` when reproduction steps or expected behavior are unclear -> `diagnosing-bugs` -> `systematic-debugging` -> `learn-codebase` -> regression test -> fix -> `verification-before-completion`

### Code review

`code-review` -> `security-review` when security or user data is involved -> `ponytail-review` when complexity is a concern -> report findings by severity

### Frontend or web app

`grilling` when audience, workflow, or acceptance criteria are unclear -> `brainstorming` -> `frontend-design` -> `ui-ux-pro-max` -> `frontend-patterns` -> implementation -> `webapp-testing` -> `e2e-testing` -> `verification-before-completion`

### Backend or API

`grilling` when business rules or compatibility requirements are unclear -> `domain-modeling` -> `api-design` -> `backend-patterns` -> `security-review` -> `test-driven-development` -> implementation -> `verification-before-completion`

### Spreadsheet or data analysis

`spreadsheets` -> `spreadsheets:excel-live-control` only when a live Excel workbook must be controlled -> preserve source -> validate formulas and totals -> `verification-before-completion`

### Word, PDF, or report

`docx` or `documents:documents` -> `pdf` or `pdf:pdf` when applicable -> `article-writing` -> `humanizer-zh` for Chinese prose -> inspect formatting -> `verification-before-completion`

### Research or competitive analysis

`research` -> `deep-research` for multi-source work -> `competitive-platform-analysis` when comparing products -> `benchmark-methodology` for measurements -> `competitive-report-structure` -> source and date checks

### Brand, image, or visual design

`brand-discovery` -> `brand-voice` -> `brand-guidelines` -> `imagegen` or `canvas-design` -> `design-is` -> visual and format checks

### Presentation

`brainstorming` -> `article-writing` -> `presentations:Presentations` or `pptx` -> `theme-factory` -> slide overflow and consistency checks

### Agent or MCP development

`product-capability` -> `domain-modeling` -> `mcp-builder` or `mcp-server-patterns` -> `security-review` -> `test-driven-development` -> `verification-before-completion`

### Long-running or handoff work

`learn-codebase` -> `pathfinder` -> `planning-with-files` -> implementation -> `handoff` -> `standup` when progress across workspaces is needed

## Safety and scope

- Prefer existing project patterns, dependencies, and helper APIs.
- Do not delete files, reset Git, commit, publish, deploy, or modify unrelated files unless the user explicitly requests it.
- For external, current, legal, medical, financial, or security-sensitive facts, verify with authoritative sources when browsing is available.
- For files, preserve the source unless the user explicitly requests in-place replacement.
- Never claim completion without running the most relevant available verification.

## Response format

At the end, provide:

1. `Workflow used`: the selected workflow and key skills.
2. `Completed`: concise list of changes or findings.
3. `Verification`: tests, checks, rendering, or source validation performed.
4. `Risks or gaps`: unresolved items or assumptions.
5. `Next step`: only when a concrete next action is useful.

For code review, findings must come first and be ordered by severity with file and line references.

## When to use grilling

Use `grilling` before implementation when any of these conditions apply:

- The user has not defined what success looks like.
- There are conflicting priorities such as speed versus completeness or compatibility versus redesign.
- The task changes production systems, authentication, payments, personal data, or other high-impact behavior.
- The requested scope is broad enough that hidden assumptions could cause substantial rework.
- The user asks for a plan or decision but has not provided the constraints needed to choose responsibly.

Do not use it as a mandatory preliminary step for a small, concrete request with clear inputs and an obvious acceptance test. After the questions are answered, continue with the selected workflow instead of repeating the interrogation.
