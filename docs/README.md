# Home docs

This map points to Home's current product, engineering, delivery, setup, and integration references. Git history and closed issues retain superseded plans and audit snapshots.

## Start here

- [Product strategy](product-strategy.md) — customer, vision, MVP scope, and completion proofs.
- [Architecture](architecture.md) — the normative technical direction and seams; it wins when another document disagrees.
- [Contributing](../CONTRIBUTING.md) — local checks, app boundaries, and the engineering contribution contract.
- [Repository README](../README.md#get-started) — install and run Home; [Fork and extend](fork-and-extend.md) covers operator customization.

## Core contracts

- [Actions](actions.md) — prepare → confirm → dispatch → handle, records, status, retries, and owner fencing.
- [Balances](balances.md) — enumeration, pinned reads, resolution, pricing, snapshots, and cache behavior.
- [Borrow](borrow.md) and [Morpho markets](morpho-markets.md) — isolated-market product and protocol boundaries.
- [Funding provider seam](funding-provider-seam.md) — adapter contract, order lifecycle, receipt rules, and provider rollout evidence.
- [Regional money](regional-money.md) and [currency defaults](currency-defaults.md) — presentation, asset mapping, and default selection.

## Delivery and design

- [Operating manual](operating-manual.md) — Jesse/factory roles, issue intake, delivery loop, proof bar, and merge policy.
- [GitHub Project](github-project.md), [PRD template](prd-template.md), and [delivery gates](delivery-gates.md) — issue placement, shaping, and repository/deployment checks.
- [Browser validation](browser-validation.md) and [UI PR previews](ui-pr-previews.md) — interactive iteration, regression ownership, and current-head visual proof.
- [UI direction](ui-direction.md) and [design system](design-system.md) — product presentation rules, owned components, tokens, and lint contracts.
- [Observability](observability.md) and [performance observability](performance-observability.md) — privacy-safe events, performance marks, and verification.
- [Vercel deploy](vercel-deploy.md) — Bun monorepo deployment and database migration setup.

## Integrations and data

- [Issuer integration guide](integrations/README.md) — funding-provider adapter walkthrough.
- [Base Account](base-account.md) — native account configuration and sign-in boundary.
- [CDP setup](cdp-setup.md), [error reporting](cdp-error-reporting.md), [Address History](cdp-address-history.md), and [CDP SQL](cdp-sql.md) — CDP configuration and Activity data sources.
- [Codex prices](codex-prices.md) and [Invest data](invest-data.md) — market-data integration and asset identity.
- [Morpho setup](morpho-setup.md) — Save vault configuration, candidate evidence, and verification commands.
- [Local money coverage](local-money-coverage.md) and [stablecoin candidates](stablecoin-candidates.json) — regional research inventory and contract candidates.
- [README capture guide](readme/README.md) and [PR preview captures](pr-previews/README.md) — screenshot provenance and storage conventions.

## Proposed specs

- [Public transfer feed](public-transfer-feed-spec.md) — active implementation-ready proposal for a public ERC-20 transfer feed.
- [Checking shimmer](qa/checking-97/CHECKING-SHIMMER-SPEC.md) — active QA specification for the checking loading state.
