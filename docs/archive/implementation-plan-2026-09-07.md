# Home — implementation chunks (archived 2026-09-07)

Status: **historical slice plan**, not current delivery and not a backlog to complete in order. This is the livestream two-hour chunk sequence. Several follow-on chunks (save, trade, borrow) later shipped locally on SQLite.

**Current tree:** [build status](../build-status.md) · [architecture review](../architecture-review-2026-09.md) · [docs index](../README.md)

Production-destination design (still not the live tree): [target architecture](../target-architecture.md). Product intent: [product scope](../product-scope.md).
Updated: 2026-09-08 (relocated to `docs/archive/`; body is the 2026-09-07 chunk plan).

## Review conclusion

The provider boundaries, Vercel deployment and separation of app records from chain data are sound. The main delivery risk is treating the whole technical design as day-one work. Build complete user flows in small commits, introducing abstractions when those flows need them.

Changes from this review:

- Add approximate country detection to the first visible slice. It makes the local-money story apparent before login and needs no extra service.
- Make the proposed package tree a destination, not required up-front scaffolding. Do not implement unused borrow/card/agent interfaces or a generic execution framework.
- Separate RPC-backed Home operation status from CDP SQL history. The former is required for the first spend; SQL history can ship independently afterward.
- Build locally through the feature chunks. Register webhooks and verify real delivery in the final deployment step; test handler signatures and replay behavior locally beforehand.
- Keep the 90–105-minute slot optional. A complete additional financial integration in 15 minutes is plausible only if its route and SDK have already been rehearsed; it is not a commitment.
- Carry visual polish, fork instructions and focused verification through every slice. The last 15 minutes are for final checks and cleanup, not the first design pass.

## Stream plan: four core slices and a release pass

Preflight is outside the two-hour clock: repository/project access, deploy credentials, CDP auth/sponsorship access, a funded demo account, one verified asset and one available funding route. Investigate SQL credentials without making them a prerequisite for the first transaction. These prerequisites have not been completed for this project.

| Chunk | Target | Shipped behavior | Depends on | Done when |
|---|---|---|---|---|
| 1. A local welcome | 0–20 min | Local mobile shell, responsive desktop, theme/region config, geo resolver with override and development database connection | Preflight | Local app renders selected regions using fixtures; missing detection works; production build and DB readiness pass |
| 2. Your account | 20–40 min | CDP email login, smart account, verified server identity, persisted user/wallet/preferences, real balance and receive address | 1 | Logout/login and reload restore the correct account and preference; a user cannot read another account's records |
| 3. Your first money action | 40–70 min | One supported token send, amount validation, review, user signing, durable intent/attempt, receipt-backed activity and reopen recovery | 2 | Small live transfer confirms; rejection and refresh work; duplicate submissions and uncertain outcomes cannot silently trigger another spend |
| 4. Add money and stay updated | 70–90 min | One hosted funding route, persistent checkout reference, signed CDP webhook endpoint and onchain status checks, refresh on checkout return | 3 | Funding targets the authenticated account; local signed-event fixtures update status; invalid signatures fail; duplicates/out-of-order delivery do not corrupt status; real delivery awaits release |
| Optional feature | 90–105 min | One already-verified local route, save/withdraw or trade flow | Required core slices | Meets its feature's full acceptance checks below; otherwise use this time to finish core gaps |
| Release pass | 105–120 min | First Vercel deployment, production config/migrations, webhook registration, real geo/callback smoke tests, README and walkthrough | Core slices | Fresh login → localized home → money action → refreshed activity works at the public URL; setup steps are documented |

Each feature chunk is a reviewable checkpoint commit and local demo. Small working commits and pushes within a chunk are welcome. Live deployment happens once the core flows are ready, in the final release step. If a chunk runs long, reduce optional breadth; preserve the final release window. Use the optional 90–105-minute slot as deployment buffer when needed. The core outcome is chunks 1–4 plus release, subject to provider readiness, not the whole roadmap.

## Chunk boundaries

### 1. A local welcome

Own the app shell, visual tokens, country/language config, pure region resolver and Vercel request-header adapter. Read `x-vercel-ip-country` at first render. Precedence is current explicit choice, saved account preference when available, remembered anonymous choice, detected country, then a neutral/fork fallback. Country selection remains visible and editable; returning users are not reset when traveling. Language follows saved preference or supported browser language independently.

Use country-level data only, no GPS prompt. Unsupported detection cannot enable unavailable products. Personalized rendering is request-specific rather than shared-cacheable. Test the resolver with supported/missing/unknown country fixtures and overrides, then check a deployed request because local Vercel geo headers are absent. A country switch provides the livestream's region demo without a VPN. See [Vercel geo headers](https://vercel.com/kb/guide/geo-ip-headers-geolocation-vercel-functions).

Use the [regional money specification](../regional-money.md) for country/currency candidates. Chunk 1 leads with native currency names and symbols, keeps token details secondary, and tests formatting separately from token precision. Verify selected issuer contracts before enabling actual holdings in chunk 2; verify exact funding routes in chunk 4 or local expansion.

Start the README, environment example and brand/region examples here. Validate the database connection now; user schema/migrations arrive with chunk 2. Do not create empty packages for future integrations.

### 2. Your account

Own the CDP auth/signer boundary and users, wallet links and preference schema. The server validates CDP identity and wallet ownership. On an existing account, stored preferences supersede an anonymous cookie unless the user explicitly changed the selection this session; new accounts adopt the onboarding selection. Balance/receive uses the spend-account address consistently.

Done includes missing/expired session handling, account switching without stale balances, and persisted country overrides after login/reload. An empty real wallet shows zero holdings; it never receives fixture money.

### 3. Your first money action

Own the initial money primitives, shared review component, transfer adapter, operation/attempt schema and one bounded status service. Implement one real send end to end before generalizing to other execution types. Store the attempt before dispatch and track user-operation and transaction references separately. Validate recipient, asset, chain and amount against the reviewed intent.

Activity initially covers Home operations. Live receipts establish outcome; unknown submissions stay unresolved until evidence is found. Test amount precision, account isolation, repeat submission, rejected signing and refresh during pending state. Keep fixtures focused on these cases; a full demo framework is a later contributor increment.

### 4. Add money and stay updated

Own checkout creation/correlation, CDP event normalization, `provider_events` and the Vercel webhook handler. Reuse chunk 3's status rules rather than creating a second ledger. Test the handler locally with signed fixtures; register subscriptions and verify actual delivery during the final deployment step. Document signing secrets, filters and environment isolation. Start with onramp and relevant wallet events; add Base account/contract subscriptions where they improve incoming-transfer coverage. SQL history is not required for this handler.

No cron, queue or background-worker service. Apply bounded verified updates before acknowledging; retain retryability on failure. Return URLs trigger verification. If provider checkout is not ready, keep the wallet flow working locally and clearly report the funding gap rather than mark this chunk complete.

## Follow-on chunks

These are independently reviewable feature slices, not promises for the optional 15-minute slot. Each includes its configuration, real integration, error states, checks and fork documentation.

| Order | Chunk | Dependencies | Acceptance |
|---|---|---|---|
| 5 | Local funding expansion | 4 and a verified Onramper route | Add one actual country/token/payment route, quote and hosted checkout; verify settlement; availability matches config and provider eligibility |
| 6 | Full wallet activity via CDP SQL | 2–3 and authenticated SQL access | Known incoming/outgoing smart-account records match receipts; pagination/deduplication preserve exact amounts; cached history fails gracefully without breaking balances or pending actions |
| 7 | Save | 3 and one verified Morpho vault | Deposit and withdraw both work; shares/underlying, fees, variable yield and withdrawal availability are represented correctly |
| 8 | Invest and Base memes | 3 and verified CDP trade routes | Shared quote/review/execution works; expired quotes fail; stock eligibility and curated asset lists are enforced; actual receipt outcomes refresh holdings |
| 9 | Fork/contributor experience | Core live flow | Fresh clone can run isolated credential-free fixtures; another operator can rebrand, provision their own accounts and deploy using documented steps; add doctor/config checks and broader CI |
| Later | Borrow | 3, market integration and operating readiness | Borrow, repay and collateral management ship together, with current debt/health and required monitoring |
| Later | Venice agent | Existing read/action services | Read portfolio, explain, prepare supported action; user signs through the same review; inference budgets are bounded |
| Later | Rain card | Program access and funding-model decision | End-to-end program onboarding, funding and card lifecycle validated; scope its settlement/ledger requirements before enabling |

After the core, prioritize whichever verified integration most strengthens the live story. The order above favors local money; SQL, save and trade can be reordered without changing the foundation. Do not create speculative tables for future modules.

## Definition of done per chunk

A feature slice has working local UI, its actual server/provider boundary, applicable migration/config changes, useful failure states, focused checks and updated setup instructions. Deployment-dependent geo and callback checks remain explicit release acceptance items. Run typecheck/build and the checks relevant to that slice; test deployed provider callbacks in the environment where they operate. Record any real integration gaps explicitly. No feature counts as shipped solely because its preview looks complete.
