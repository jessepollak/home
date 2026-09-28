# Home Figma library: finance design system

Issue [#791](https://github.com/jessepollak/home/issues/791) extends the published Home Library from [#683](https://github.com/jessepollak/home/issues/683) into a library for building the rest of Home. This index links to the gap matrix, the Mobbin pattern inventory, the Code Connect plan and the publish checklist. It is a proposal: Jesse selects, refines and publishes. Nothing here changes production code.

- Figma file: [Home](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home). Library page: [Components](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=4-2) (`4:2`); current screens: [Home](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=333-13084) (`333:13084`). Component and page inventory: [figma-mapping.json](figma-mapping.json).
- Source SHA for tokens and component contracts: `e76eaf7b` (run 12 rebase; the Home components and `components/ui/*` are unchanged since `bfe24dc6`, the #804 Home migration that run 11 audited, including the `MoneyConfirmFooter` contract from `9ab2097`).
- On Components, left to right: [Foundations](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=156-2094) (`156:2094`) → [Primitives](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1804) (`158:1804`) → [Finance patterns](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1704) (`166:1704`) → [Home components](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=11-767) (`11:767`). On Home: [Screens](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=11-768) (`11:768`) → [Home states](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=190-2821) (`190:2821`) → [#638 proposal](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=311-12034) (`311:12034`). [References](https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=174-2891) (`174:2891`) is on its own page. See [File structure](design-system/file-structure.md).

- [Revisions](design-system/revisions/)
- [Rules this library follows](design-system/rules.md)
- [Foundations](design-system/foundations.md)
- [Gap matrix](design-system/gap-matrix.md)
- [Pattern inventory](design-system/pattern-inventory.md)
- [Code Connect](design-system/code-connect.md)
- [Publish checklist](design-system/publish-checklist.md)
- [Follow-up code issues](design-system/follow-up-code-issues.md)
- [Send recipient board (#953)](design-system/boards/send-recipient-953.md)
- [File structure and the instances-only rule](design-system/file-structure.md)
- [Known limits](design-system/known-limits.md)
- [Component notes](design-system/components/)
- [Follow-ups](design-system/follow-ups/)

## Where new entries go

A new top-level topic gets a new file in `docs/design-explorations/design-system/` linked from this index; a new board or proposal gets `boards/<name>.md`; a new revision or run goes in `revisions/`; a new component entry gets `components/<name>.md`; a new follow-up gets `follow-ups/NN-name.md`; a mapped Figma component gets `apps/web/figma/components/<Name>.json` (one file per component). Never append a new section to this index.
