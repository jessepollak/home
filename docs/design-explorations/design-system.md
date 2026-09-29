# Home finance design-system explorations

Issue [#791](https://github.com/jessepollak/home/issues/791) extends the Home component library from [#683](https://github.com/jessepollak/home/issues/683). This index links the historical gap matrix, pattern inventory, revision notes and follow-up coverage. Review and selection now happen on [Storybook review boards](../design-system/component-workshop.md#review-boards); nothing here changes production code.

- Production components and story scenarios live under `apps/web/components/` and `apps/web/client/`; review boards compose their stories.
- Source SHA for tokens and component contracts: `e76eaf7b` (run 12 rebase; the Home components and `components/ui/*` are unchanged since `bfe24dc6`, the #804 Home migration that run 11 audited, including the `MoneyConfirmFooter` contract from `9ab2097`).
- [Storybook review-board workflow](../design-system/component-workshop.md#review-boards) is the current design surface.

- [Revisions](design-system/revisions/)
- [Rules this library follows](design-system/rules.md)
- [Foundations](design-system/foundations.md)
- [Gap matrix](design-system/gap-matrix.md)
- [Pattern inventory](design-system/pattern-inventory.md)
- [Follow-up code issues](design-system/follow-up-code-issues.md)
- [Send recipient board (#953)](design-system/boards/send-recipient-953.md)
- [Known limits](design-system/known-limits.md)
- [Component notes](design-system/components/)
- [Follow-ups](design-system/follow-ups/)

## Where new entries go

A new top-level topic gets a new file in `docs/design-explorations/design-system/` linked from this index; a new board or proposal gets `boards/<name>.md`; a new revision or run goes in `revisions/`; a new component entry gets `components/<name>.md`; a new follow-up gets `follow-ups/NN-name.md`. Never append a new section to this index.
