# Docs

Start with [Architecture](architecture.md), the one normative design document; [Actions](actions.md) and [Balances](balances.md) are its subsystem designs. [Build status](build-status.md) records the local-app boundary; [Fork and extend](fork-and-extend.md) is the operator path.

| Doc | Description |
| --- | --- |
| [Architecture review](architecture-review-2026-09.md) | Current-tree boundaries, risks, and contribution rules. |
| [Archive index](archive/README.md) | Historical documents and why they moved. |
| [Archived implementation plan](archive/implementation-plan-2026-09-07.md) | September 7 livestream plan; not a current backlog. |
| [Balances inventory architecture](balances-inventory-architecture.md) | Bounded wallet and savings inventory decisions. |
| [Base Account](base-account.md) | Optional Base Account configuration. |
| [Build status](build-status.md) | Local-app scope and validation boundary. |
| [Checkpoint 2026-09-12](checkpoint-2026-09-12.md) | State of main after the Home-is-thin reset; decisions, open items, how to resume. |
| [Architecture audit 2026-09-12](architecture-audit-2026-09-12.md) | Post-reset audit of server, funding seam, and client; ranked cleanup lanes and decisions. |
| [CDP error reporting](cdp-error-reporting.md) | Default CDP error-reporting policy. |
| [CDP setup](cdp-setup.md) | CDP project, sessions, and allowed origins. |
| [CDP SQL](cdp-sql.md) | Indexed Base-history adapter notes. |
| [Codex prices](codex-prices.md) | Server-side Invest price integration. |
| [Currency defaults](currency-defaults.md) | Default asset choices by currency. |
| [Delivery gates](delivery-gates.md) | Repository and deployment gate boundary. |
| [UI system](design-system.md) | Owned shadcn components, Home theme tokens, lint rules, and testing stance. |
| [Docs index](README.md) | This complete documentation index. |
| [Fork and extend](fork-and-extend.md) | Operator customization and hosting guide. |
| [Funding provider seam](funding-provider-seam.md) | Funding adapter contract and design history. |
| [Architecture](architecture.md) | Principles, seams, data model, flows, client, quality bar, fork contract. Wins over every other doc. |
| [Actions](actions.md) | The action record, derived status, prepare → confirm → dispatch → handle, SDK-verified retry semantics, owner fence. |
| [Balances](balances.md) | One balances pipeline and snapshot: enumerate → resolve → read → price; device and server caching. |
| [Implementation plan](implementation-plan.md) | Redirect to the archived livestream plan. |
| [Issuer integration guide](integrations/README.md) | Funding-provider adapter walkthrough. |
| [Invest data](invest-data.md) | Invest asset identity and data notes. |
| [Morpho setup](morpho-setup.md) | Morpho vault configuration and verification. |
| [Verified Morpho markets](morpho-markets.md) | Shared registry, math, pinned RPC reader, and product projection boundary for isolated markets. |
| [Observability](observability.md) | Privacy-safe application observability. |
| [Operating manual](operating-manual.md) | Team workflow, labels, and proof bar. |
| [PR previews](pr-previews/README.md) | Preview capture conventions. |
| [Product scope](product-scope.md) | Product intent, not delivery status. |
| [Public transfer feed spec](public-transfer-feed-spec.md) | Proposed public ERC-20 transfer feed. |
| [QA checking shimmer spec](qa/checking-97/CHECKING-SHIMMER-SPEC.md) | Checking shimmer QA specification. |
| [README capture guide](readme/README.md) | Screenshot provenance and regeneration. |
| [Regional money](regional-money.md) | Regional presentation and stablecoin candidates. |
| [Target architecture](target-architecture.md) | Historical September 7 build plan; superseded by [Architecture](architecture.md) where they disagree. |
| [Technical design](technical-design.md) | Redirect to target architecture. |
| [UI direction](ui-direction.md) | Product UI rules and visual direction. |
| [UI PR previews](ui-pr-previews.md) | Required proof for user-visible changes. |
| [Vercel deploy](vercel-deploy.md) | Bun monorepo Vercel setup. |
