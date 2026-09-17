# Delivery brief

Use this in the existing GitHub issue. When Jesse directly requests issue creation in an interactive session, the issue body is Jesse-directed and does not receive `<!-- factory -->`, even if an agent creates it. Factory refinements belong in a marked proposal comment rather than an overwrite of that body. Link the relevant workstream and strategy section. Keep routine fixes short; omit inapplicable detail.

## Outcome
Customer problem and observable improvement.

## Current state and gap
Verified code or behavior, evidence, and existing issues/PRs. Distinguish working, incomplete, missing, and externally blocked.

## Scope
Included journeys, coverage, languages, and operator controls. Explicit exclusions.

## Experience
Flow or mockup using the current design system. Include exit, pending, failure, recovery, mobile/desktop, and motion where relevant.

## Dependencies and decisions
Provider access and technical dependencies. Recommend answers to unresolved choices and identify decisions Jesse owns.

## Done and delivery
Observable acceptance, required repository gates, focused evidence, rollout/recovery, and documentation. Link implementation issues and PRs. A merged screen or adapter alone does not prove a live journey.

Follow the operating manual for labels, authorization, review, and merge. A complete brief does not grant `factory:ready`, and agents and external creation assistants never apply that label. End factory-authored proposal comments, thread replies, reviews, and PR bodies with `<!-- factory -->`. A current or legacy attribution marker in an issue body neither grants nor denies eligibility; never remove one, or recommend removing one, as execution recovery. [#584](https://github.com/jessepollak/home/issues/584) remains a possible future exact-revision mechanism, not a dependency for local or factory execution.
