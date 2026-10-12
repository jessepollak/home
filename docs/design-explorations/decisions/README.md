# Design decisions

Keep one file per decision; never append entries to a shared list or table. Name files `<surface>-<issue>.md`, using the issue that owns the decision. Separate axes on the same surface into separate records.

Each record contains:

- **Surface:** the screen or component the decision applies to.
- **Axis:** the visual or interaction choice being decided.
- **Verbatim words:** Jesse's recorded words; write `not recorded` when the source has no verbatim quote.
- **Status:** `selected`, `rejected`, or `superseded`.
- **Board frame link:** the reviewed story/frame URL, retaining revision and deployment when recorded; use — where no board applies.
- **PR link:** the source review or adoption PR; use — when not recorded, and retain issue links in the notes.
- **Date:** the decision date; write `not recorded` when unknown.
- **Notes:** rationale, accepted revision, refinements, alternatives not carried forward, adoption ownership and meaningful exceptions.

Propose, review and select on the [Storybook review board](../../design-system/component-workshop.md#review-boards). Deployment-relative board links in these records identify current review context where the historical deployment was not recorded; they are not evidence that Jesse approved a later revision. The [design-engineering skill](../../../.agents/skills/design-engineering/SKILL.md#working-sequence) reads the relevant records before proposing.
