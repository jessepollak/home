---
name: retro
description: Conduct a retrospective on a completed Home coding session and propose durable improvements to the repository's agent environment. Use only when the user explicitly runs /skill:retro or asks for a coding-session retrospective.
disable-model-invocation: true
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/in-progress/retro
  adapted-for: jessepollak/home
---

# Home coding-session retrospective

Review a completed coding session and propose the smallest durable changes that would improve future runs. This skill is review-only unless the user separately approves implementation.

## Process

1. Identify the session to review. Use the current session when the user does not name another one.
2. Read primary evidence rather than relying on the session summary: the relevant transcript or logs, `git status`, the diff or commits produced, test output, and review findings.
3. Read the repository's existing sources of truth before proposing changes:
   - root and relevant nested `AGENTS.md` files;
   - `docs/operating-manual.md` and any linked domain document that governed the work;
   - `package.json`, `apps/*/package.json`, lint configuration, hooks, and `.github/workflows/`;
   - the implementation and tests involved in the observed failure.
4. Find concrete improvement candidates in the categories below.
5. Present only supported candidates, ordered by severity and expected recurrence. Do not edit files during the retrospective.

## Candidate categories

- **Deterministic guardrails:** Could a lint rule, type check, test, filesystem check, pre-commit hook, or CI job prevent the failure? Read the existing `bun check` path and CI wiring first. A check that exists but is unwired, silently broken, or missing a known-positive control is the finding; do not reinvent it. Missing CI coverage for an existing required check is itself a finding.
- **Judgment guidance:** Did the failure require intent or cross-file judgment that no deterministic guardrail can encode reliably? Put any proposed guidance in the existing authoritative document or review workflow. Do not create `CODING_STANDARDS.md` by default.
- **Navigation:** Did the agent struggle to find the deciding file, hidden dependency, or ownership boundary? Prefer one short pointer in the nearest applicable `AGENTS.md` over duplicating the underlying rule.
- **Workflow:** Did task intake, issue ownership, sequencing, review, validation, or delivery diverge from `docs/operating-manual.md`? Propose a change only if the current workflow failed, not merely because another workflow is possible.
- **Tool economy:** Could an expensive or repetitive exploration step become one reliable command, helper, or narrower source lookup?
- **No-ops and stale guidance:** Does an instruction fail to change behavior, duplicate another source, or describe a repository state that no longer exists?
- **Information access:** Was a necessary log, fixture, local service state, or read-only integration unavailable? Prefer the least-privileged access that would have resolved the gap.

## Classify the prevention mechanism

- A **mechanical** violation is a fixed, machine-detectable pattern: a banned API, import shape, file-location rule, schema invariant, or required command. Prefer a deterministic check in the repository's existing toolchain over prose.
- A **judgment** violation depends on intent, product context, surrounding style, or trade-offs. Prefer concise reviewer guidance or a pointer to the deciding document.
- If a proposed deterministic check may create false positives, require expensive infrastructure, or duplicate an existing gate, say so and recommend the cheaper reliable mechanism.

## Evidence bar

For every candidate include:

- the observed failure, with a file, command, diff, or transcript reference;
- why the failure is likely to recur;
- the smallest durable prevention mechanism;
- where that mechanism belongs;
- how to verify that it works, including a known-positive control for a new check.

Reject speculative lessons, one-off preferences, and improvements whose maintenance cost exceeds the demonstrated failure. If no candidate clears the evidence bar, report that the session produced no durable environment change.
