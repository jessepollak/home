# Design-lane non-production code

Non-production, design-lane code is allowed in exactly two places:

1. Inside a story file (`*.stories.tsx` / `*.stories.ts`), as story-only
   fixtures, helpers, and local candidate UI.
2. Under an `explorations/` directory (`**/explorations/**`).

Nowhere else. A module that exists only to support a story or an exploration
must live in one of those two locations. Production modules may not import
Storybook, story files, MSW, or `explorations/` code. Oxlint enforces the
Storybook, story-file, and MSW boundaries; the `explorations/` boundary is a
reviewed repository convention.

The dead-code gate (`bun run --cwd apps/web knip`, from `bun check`) ignores
`**/explorations/**`. Story files are not analyzed as production code, so a
design candidate that lives inside a story never has to masquerade as a
production module to pass the gate.

See [design-system](../design-system.md) and the
[design-engineering skill](../../.agents/skills/design-engineering/SKILL.md)
for the exploration workflow and its review checkpoint.
