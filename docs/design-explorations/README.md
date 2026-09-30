# Design-lane non-production code

Non-production, design-lane code is allowed in exactly two places:

1. Inside a story file (`*.stories.tsx` / `*.stories.ts`), as story-only
   fixtures, helpers, and local candidate UI.
2. Under an `explorations/` directory (`**/explorations/**`).

Nowhere else. A module that exists only to support a story or an exploration
must live in one of those two locations. Production modules may not import
Storybook, story files, MSW, or `explorations/` code. Oxlint enforces all four
boundaries; `home/no-exploration-imports` rejects any import, re-export,
dynamic import, `require()`, or type query (`typeof import("./x")`) of an
`explorations/` path from a production module, so a barrel cannot expose
exploration code. `home/no-test-support-imports` closes the other barrel path:
a production module cannot import a `tests/`, `testing/`, or `*.test.*` module
either.

Keep proposals thin: compose owned `apps/web/components/ui` components and
variants with existing feature components instead of rebuilding shells or
controls. Drive story states with static fixtures and args, not bespoke state
machines or data logic. If the brief needs a genuinely new primitive, isolate
it as a clearly named proposal component using existing tokens and logical
properties. When a review finding applies to a pattern, fix every instance of
that pattern in the diff, not only the cited example.

The dead-code gate (`bun run --cwd apps/web knip`, from `bun check`) ignores
`**/explorations/**`. Story files are not analyzed as production code, so a
design candidate that lives inside a story never has to masquerade as a
production module to pass the gate. Do not add a Knip `entry` or `ignore`
exemption for a production-path module that only stories or explorations
reach, directly or through a chain of modules nothing else consumes:
`bun run gates` fails it. `scripts/gates/knip-exemptions-baseline.json` is the
reviewed exception surface, so an exemption passes only when the same change
adds a baseline entry with a reason, and a baseline entry fails as
stale once a product screen imports the module, so remove both together.

While a design is being selected, a shared component `cva` variant or export
that only stories and explorations use is reported, not blocked: `bun run gates`
prints each one, and `node scripts/gates/story-only-usage.mjs` prints the same
list. Adoption either wires the variant into a product screen or deletes it.

Propose, review, and select candidates on the [Storybook review board](../design-system/component-workshop.md#review-boards). See [design-system](../design-system.md) and the
[design-engineering skill](../../.agents/skills/design-engineering/SKILL.md)
for the exploration workflow and its review checkpoint.
