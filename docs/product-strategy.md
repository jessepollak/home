# Home product strategy

September 16, 2026 · Vision, MVP, and agent handoff

## Start here

**Home is the open-source platform for running a neobank.** Our customers are businesses serving specific countries, communities, and audiences. We supply the product and technology; operators bring their customers, distribution, and local expertise.

**First milestone:** a complete MVP Jesse can use personally and another person can deploy and run as a branded, multi-user Home. Operator discovery happens in parallel; recruiting an operator does not block the build.

**One-year goal:** five growing neobanks independently running Home, serving customers across countries, adopting upstream improvements, and contributing fixes. Grow actual local-stablecoin use, holders, and balances through those businesses.

This document defines product direction and scope. GitHub issues track delivery. It does not claim the listed capabilities are shipped.

### Instructions for the next agent

1. Read the relevant workstream below and the repository's current `AGENTS.md`.
2. Inspect the code and existing issues. Identify what works, what remains, and what needs external access. Reuse existing issues.
3. Turn a bounded gap into a PRD using section 6. Bring a recommendation for consequential open decisions.
4. Execute under the repository's operating manual. This strategy grants no additional execution, release, or merge authority.

## 1. Vision and product principles

Many valuable financial products will serve a particular audience: a country, a profession, or a community spread across countries. Home lets those businesses offer excellent local and global money experiences on a shared foundation.

We build one default product that operators configure and extend. Jesse's private Home uses that same software to expose daily friction. Personal use informs quality; operator success determines the business. We are not launching a broad consumer Home brand or a separate hobbyist product at the outset.

Six principles guide decisions:

1. **Serve operators through an excellent customer product.** Make both the money experience and running the business straightforward.
2. **Complete the money journey.** Funding, saving, spending, investing, and borrowing include their exit and recovery paths. Money must move coherently between them.
3. **Scale coverage through shared systems.** Regions, assets, and markets should use common flows and validated configuration. A new entry that fits an existing integration should not need bespoke screens. Start with concrete providers; add abstractions when real integrations require them.
4. **Make everyday finance local and understandable.** Support familiar currencies and languages. Lead with useful financial outcomes while keeping underlying assets, costs, and status accurate.
5. **Make beauty and trust part of MVP.** Mobile web and desktop must feel polished. Motion, reliability, security, and privacy accompany every feature.
6. **Let operators own and improve their Home.** Routine administration belongs in a dashboard. Customization should survive upstream updates, and useful contributions should improve the common product.

## 2. Pillars and MVP scope

There are **six capability workstreams and two shared quality workstreams**. All eight are part of MVP. This section is the sole scope definition; later sections explain verification and execution.

### Capability workstreams

| Workstream | Outcome | Required in MVP |
| --- | --- | --- |
| **Money in/out** | Customers can bring local money in and take it back out. | USD plus the regional portfolio in section 3, including Peer.xyz for both onramp and offramp; onramps, offramps, necessary conversion, quotes/fees, status, and recovery. |
| **Save and spend** | Customers can earn on their money and use it day to day. | Dollar yield and local-currency yield wherever an accessible product exists; deposit/withdraw, balances and variable APY; P2P send/receive; one usable card program with funding, controls, purchases, declines, refunds, and Activity. |
| **Invest** | Customers can discover, understand, buy, hold, and sell investments. | All stocks on Base, plus memes and major crypto assets; search, good charts, basic research, buying/selling, holdings, and valuation. Stocks remain central to the experience. |
| **Credit** | Customers can do more with their capital. | All available Base borrow markets for Coinbase assets (cb assets); market discovery, collateral, borrowing capacity, rates, loan health, borrow/repay, and collateral withdrawal. |
| **Operator platform** | An operator can launch, configure, support, and update a Home. | Guided Vercel setup; protected admin dashboard; brand/colors, regions, assets, products, and provider settings; secure credential setup and connection checks; customer access controls; basic user/transaction support lookup; an update and recovery path. |
| **Identity and account** | Customers can access their account and unlock the services they need. | Sign-in/out and recovery; one identity integration with verification status, retry, and resume; verification when required by a capability; country, currency, and language preferences. Reuse verification where downstream providers accept it. |

### Shared quality workstreams

| Workstream | Required across MVP | Review evidence |
| --- | --- | --- |
| **Design and experience** | Beautiful mobile web and desktop; shared components, intentional responsive layouts, excellent animation and interaction feel, accessible controls, and polished loading/error/recovery states. | Real-phone and desktop walkthroughs; video for motion. Check gesture reversal, interrupted transitions, focus, keyboard/pointer use, reduced motion, and long translated text. |
| **Engineering, security, and privacy** | Maintainable shared architecture; correct balances and Activity; safe money actions; user/admin isolation; protected credentials; minimal identity data; diagnostics; repeatable setup and upgrades. | Existing repository gates and focused journey evidence, including retries, refresh/relogin, failure recovery, and independent deployments. No known critical money, privacy, or access-control defect. |

### Scope details that matter

**Regional languages.** Basic language support covers the supported regions: core journeys, account settings, transaction review, confirmations, actionable errors, and operator setup essentials. Define the region-to-language mapping. Let users choose language independently of country/currency, persist it, and format amounts/dates correctly. Review translated financial copy, text expansion, and right-to-left layouts where needed. Record limitations in provider-hosted screens.

**Savings.** Inventory yield products for every supported local currency. Include existing accessible products with complete deposit and withdrawal paths. A dollar product displayed in local currency is still dollar yield. Currencies without an available yield product should say so; creating new yield products is outside MVP.

**Cards.** Start with one provider and a card that supports actual spending. Virtual issuance is sufficient only if it delivers the intended use; include mobile-wallet provisioning if required for everyday in-person spending. Specify the funding source, authorization/settlement behavior, freeze/unfreeze, and support/dispute handoff. Card issuance alone is not completion.

**Asset and market coverage.** Define authoritative catalogs and refresh behavior for stocks, memes/majors, and cb-asset markets. Validate exact identities and per-market parameters. The meme/major catalog needs an inclusion rule; it does not mean every token on Base. Missing execution paths remain explicit gaps against the agreed coverage. New protocols may require integrations even when the UI is shared.

**Identity.** One coherent Home flow does not guarantee that every provider accepts the same verification. Preserve actual provider requirements, prefer provider-held documents, and keep only necessary references/status in Home.

**Motion and feel.** Use shared defaults and approved reference journeys for navigation, sheets/dialogs, drag/release, back/close/reopen, number changes, charts, and loading transitions. Motion should respond immediately, remain interruptible, and avoid layout jumps. Desktop deserves intentional layouts and interactions, alongside mobile touch behavior.

### After MVP

Keep these outside the initial release: index products and deeper investment research; recurring investing; undercollateralized credit and non-cb collateral expansion; general AI/natural-language customization; additional hosting targets; a plugin marketplace; sophisticated staff permissions, billing, or revenue-sharing systems; additional card/identity providers; and a separate personal-edition onboarding flow.

These preserve the longer-term vision. They do not defer the agreed regional coverage, local yield where available, stock/meme/major coverage, cb-asset markets, languages, or design quality.

## 3. Regional money portfolio

Use the portfolio from [GitHub #539](https://github.com/jessepollak/home/issues/539#issuecomment-5691816368), **amended by Jesse's latest instruction to defer wMXN**. This leaves nine provider workstreams and thirteen non-USD token/provider bindings, plus the existing USD baseline. A binding is a delivery target, not a claim of live availability or a count of supported countries.

| Currency → asset | Provider | Existing workstream |
| --- | --- | --- |
| EUR → EURC | Coinbase | [#294](https://github.com/jessepollak/home/issues/294) |
| CAD → CADD | Tetra | [#551](https://github.com/jessepollak/home/issues/551) |
| MXN → MXNB | Juno / Bitso | [#552](https://github.com/jessepollak/home/issues/552) |
| ARS → wARS; BRL → wBRL; COP → wCOP; CLP → wCLP; PEN → wPEN | Ripio | [#512](https://github.com/jessepollak/home/issues/512) |
| NGN → cNGN | Africa Stablecoin Consortium | [#553](https://github.com/jessepollak/home/issues/553) |
| ZAR → ZARP | Approved ZARP partner | [#554](https://github.com/jessepollak/home/issues/554) |
| IDR → IDRX | IDRX | [#555](https://github.com/jessepollak/home/issues/555) |
| AUD → AUDD | AUDD Mint | [#556](https://github.com/jessepollak/home/issues/556) |
| SGD → XSGD | StraitsX | [#557](https://github.com/jessepollak/home/issues/557) |

**Peer.xyz is also required in MVP for both onramp and offramp**, alongside the regional issuer routes above. Reuse [#436](https://github.com/jessepollak/home/issues/436). Define its supported countries, currencies, payment methods, settlement assets, eligibility, liquidity, fees, status, and recovery paths; verify cash-in and cash-out separately. Record missing or blocked paths explicitly. Peer does not replace any agreed regional route, and its bindings are additional to the thirteen listed above until inventoried.

For each binding, track country/audience, local payment rail, exact Base asset, cash-in, cash-out, fees, status/recovery, provider access, and evidence. Confirm exits separately: earlier onramp research did not establish every withdrawal route.

At the last repository review, Coinbase EURC was planned, Ripio CLP/PEN local rails were unresolved, and some routes required business/institutional access. Verify current status in the linked issues. External blockers remain visible; changing release scope requires a product decision.

Related records: [shared provider acceptance #541](https://github.com/jessepollak/home/issues/541), [coverage representation #558](https://github.com/jessepollak/home/issues/558), and [portfolio tracker #15](https://github.com/jessepollak/home/issues/15). The Ripio and coverage issues now reflect MXNB-only scope. Historical research remains a record of earlier decisions.

## 4. What makes the MVP complete

The release must pass three practical proofs:

| Proof | What must work |
| --- | --- |
| **Jesse can use it** | Real money journeys across the accessible capabilities, over repeated visits. Eligible testers cover regional/product paths unavailable to Jesse. |
| **Another person can run it** | A separate branded business instance with its own credentials/database, multiple users, guided setup, routine administration, and one upstream update that preserves configuration. No bespoke core rewrite. |
| **The whole product holds together** | Required coverage is accounted for; balances, positions, debt, card activity, and transaction history stay coherent across products and after failures/retries. Mobile, desktop, languages, and motion meet the quality bar. |

Money must be able to return to usable cash and leave Home. Savings, collateral, and card allocations must not be double-counted or presented as automatically spendable.

Validate catalog identities and parameters across the full scope. Use proportional end-to-end checks for distinct provider/protocol paths and meaningful edge cases. One successful sample does not establish catalog coverage; identical integrations do not need duplicated full test suites.

Live capability claims need live evidence under the existing approval rules. Sandboxes and fixtures support development. Mark unproven or blocked paths explicitly rather than treating a screen or adapter as a finished product.

These proofs establish readiness for operator pilots. External operator adoption then tests the business thesis.

## 5. Delivery order

| Step | Work | Result |
| --- | --- | --- |
| **1. Establish the gaps** | Audit code and issues against section 2. Inventory routes, languages, yield products, assets, and markets. Start provider access work, especially cards and identity. | An evidence-backed view of working, incomplete, missing, and externally blocked capabilities. |
| **2. Deliver complete journeys** | Build the shared account/data/configuration foundations and complete each workstream. Include language, design, and quality work in every delivery. | Usable capabilities across the agreed scope. |
| **3. Prove the release** | Run the three proofs above, fix gaps, and rehearse installation and upgrading. | A complete MVP ready for external operator pilots. |
| **4. Grow through operators** | Help operators launch, observe customer use and support needs, and improve the shared product. | Progress toward five growing neobanks. |

Independent work can proceed in parallel when dependencies allow. Operator discovery runs alongside steps 1–3. Start from existing work rather than restarting features to fit this outline.

Track outcomes: successful money journeys, repeated customer use, operator setup/support effort, upgrade adoption, and local-stablecoin holders/balances. Define measurements before setting numerical targets. Use operator-local or consented reporting; the current architecture has no upstream customer telemetry. Avoid double-counting funds when reporting balances or TVL.

## 6. PRDs and agent handoffs

Keep one brief on the existing GitHub issue or linked epic. Routine bugs can use a shorter version.

| Field | Required answer |
| --- | --- |
| **Outcome** | Which workstream and customer problem does this advance? |
| **Current state and gap** | What is verified in code or live behavior? What remains? Link existing work. |
| **Scope** | Which journeys, routes/assets/markets, languages, and operator controls are included? What is excluded? |
| **Experience** | Show the flow using shared components, including exit, pending, failure, and recovery. Include mobile/desktop behavior and motion where relevant. |
| **Dependencies and decisions** | Name provider access, integration boundaries, and unresolved choices. Recommend an answer; identify decisions Jesse must make. |
| **Done and delivery** | Specify observable acceptance, proportionate checks and preview evidence, linked implementation issues, rollout/recovery needs, and documentation updates. |

Product shapes the brief; design makes experience changes reviewable; intake checks completeness; Hugo/factory implements under the existing process. Jesse retains direction, consequential decisions, execution authorization, final approval, and merge. Agents resolve routine choices from established principles and bring recommendations for genuine tradeoffs.

### Implementation questions still open

These questions refine delivery; they do not reopen the agreed MVP breadth.

| Question | Next useful output |
| --- | --- |
| Which card provider? | Evaluate Rain (name confirmed by Jesse) and StraitsX, including regional eligibility and partner access; recommend one for MVP. Neither is selected yet. |
| Which identity provider? | Jesse has no strong preference. Evaluate providers against supported regions/documents, mobile completion and recovery, downstream card/ramp acceptance, privacy/data handling, operator setup, and integration effort; recommend one for MVP. |
| What needs Peer input? | Jesse is already in contact and can bring Peer in as needed. Consolidate specific unresolved integration and corridor questions before requesting an introduction. |
| How does dashboard configuration work? | Propose a focused evolution of current typed configuration and deployment secrets, including validation, administrator authority, and upgrade behavior. |
| What are the exact coverage inventories? | Specify language mappings, existing yield products, stock and meme/major catalog sources, cb-asset identities, market sources, and refresh rules. |
| Who handles service/support responsibilities? | Name operator/provider/Home responsibilities for failed funding, card issues, account recovery, and updates. Commercial model and pricing remain open. |

### Sources of truth

| Source | Owns |
| --- | --- |
| This strategy | Customer, vision, product principles, MVP scope, and completion bar |
| GitHub issues and PRDs | Delivery status, detailed designs, dependencies, and evidence |
| [Architecture](https://github.com/jessepollak/home/blob/main/docs/architecture.md) | Technical boundaries and money invariants; amend explicitly when new product requirements need changes |
| [Design system](https://github.com/jessepollak/home/blob/main/docs/design-system.md) and Home motion/mobile skills | Components and interaction implementation guidance |
| [Operating manual](https://github.com/jessepollak/home/blob/main/docs/operating-manual.md) and `AGENTS.md` | Authorization, factory workflow, review, and merge rules |

Use the [PRD template](prd-template.md) for delivery issues and the [GitHub Project guide](github-project.md) for the workstream index and board setup. Coordinate role documentation with [#561](https://github.com/jessepollak/home/issues/561).

Source: Jesse's vision narration, subsequent scope decisions, and the linked repository records. This defines intended scope, not shipped capability.
