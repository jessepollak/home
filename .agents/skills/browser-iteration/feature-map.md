# Home feature map

This is the enumerated map of every user-reachable surface in `apps/web`, written for agents that
drive the app with the repository-pinned `agent-browser` (see
`.agents/skills/browser-iteration/SKILL.md`, normalized by `docs/browser-validation.md`). Read it
before starting a browser session: pick the **surface id** you are changing, follow its **Reach**
steps from a fresh fixture session, assert the **Expect** facts, exercise every listed **State** you
touched, and capture the listed **Evidence** (screenshot, DOM text snapshot, console/errors, perf
marks by name). Selectors are quoted from the file that defines them; anything not confirmed in code
is in **Unknowns** — never invent a selector when Reach is ambiguous, snapshot first.

**Keeping this current:** run a `chore(dx)` pass whenever `apps/web/app/**/page.tsx`, `apps/web/client/*/*-experience.tsx`, or
`apps/web/tests/browser/*.pw.ts` changes. State that bracket in the PR body; do not silently drift this map.
The CI Playwright replay in `apps/web/tests/browser/feature-map-replay.pw.ts` reads the surface files
through `apps/web/tests/browser/feature-map/map.ts` and executes every non-manual fixture Reach. Keep its explicit skip
reasons aligned with the map when changing a Reach or fixture. Reach guides the agent; it never
authorizes a money click. Full-text snapshots reveal facts hidden by interactive-only snapshots; number-flow amounts appear as images (for example `image "$1.00"`), not text;
scope huge trees (notably coverage's globe), and prefer current `@refs` when names churn. Do not use `wait --text` on accessible-name-only labels when no visible copy exists. A live Reach ends at review; its separate marked confirm requires the ladder's Rung 3 or Jesse's direct authorization, a fresh `live-login` and the shared confirm lock. `HOME_VERIFY_ACCOUNT_ADDRESS` (the bot account's full 0x wallet address) is the trusted anchor. On Rung 2 up-to-review walks of a prepared wallet action and before each marked click, read the review `From` row's full address from the copy control's title or `Full address …` fallback and run `bun run --silent --cwd apps/web live-login --check-account <address>`. It compares case-insensitively against the environment or private file without printing the anchor; stop on nonzero exit. The short address alone is insufficient. If the anchor is absent on a Rung 2 walk (no click), Account settings' full address can serve only as a consistency check; evidence must say the anchor was not provisioned and bot identity was not established. Before a marked click the anchor is required: if missing, do not press the control and report `Real money: not tested`, naming `HOME_VERIFY_ACCOUNT_ADDRESS`. The row identifies the prepared action's executing account; only the provisioned anchor establishes it is the bot account. Provider funding (`add-money`) reviews carry no prepared action, `From` row or marked control; its Rung 2 walk reads the quote facts and stops before the provider hand-off.

Fixture baseline referenced throughout: `HOME_PLAYWRIGHT_SMOKE=1`, rootless
`bun --cwd apps/web dev -- --port "${HOME_FIXTURE_PORT:-3199}"` ([browser validation](../../../docs/browser-validation.md#fixture-session-on-port-3199)).
`fixture-session` seeds `sessionStorage["home:playwright-smoke:signed-in"]="1"` before navigation
and installs the [shared fixture routes](../../../apps/web/tests/browser/feature-map/fixtures.ts).
The Playwright replay uses `tests/browser/fixtures/api.ts` and the same static recipient routes.
Fixtures are session-local; balances snapshots come from `tests/browser/fixtures/balances.ts`.

## Surfaces

Each surface lives in `surfaces/<id>.md`; a change edits its surface's file, not a row in a shared table. The replay and verification-evidence gate read this directory directly. Each surface's **Entry context** lists family, route, auth state, fixture state needed, and entry trigger in that order.

API routes (no UI; listed for request-level assertions): `app/api/{access,access/logout,session,balances,activity,client-errors,client-performance,actions,actions/prepare,actions/[id],actions/[id]/confirm,actions/[id]/handle,auth/base/{nonce,verify,logout},borrow,borrow/markets/[marketId],funding/{providers,quotes,orders,orders/[id],offramp/orders,provider-customers,provider-customers/verification,webhooks/[provider]},invest/discover,market-prices,market-prices/history,savings/vaults,trades,transfers/{recipient-name,recent-recipients},webhooks/cdp}`. `/api/actions/*`, `/api/activity`, `/api/balances`, `/api/borrow`, `/api/borrow/markets/[marketId]`, and `/api/transfers/*` require `authorizeSession`; provider and public route authorization remains route-specific.

## Live hosts

Hosts Home is known to call from the browser on a deployed environment. These are
observations for reviewing browser requests, not automatic permission to widen origins.

- `media.thegrid.id`, `token-media.defined.fi` — token artwork returned by the Codex token-image lookup (`apps/web/server/market-data/codex/token-images.ts:68`) and rendered by asset marks such as the borrow market header (`apps/web/client/borrowing/borrowing-experience.tsx:440`) and the invest list; both observed in the first provisioned live canary on 2026-09-22.
- `api.ensideas.com` — Basename profile lookup (`apps/web/client/account/basename-profile.ts:9`); observed in the first production run on 2026-09-21.
- `api.cdp.coinbase.com` — CDP browser session and Coinbase onramp API (`apps/web/server/funding/providers/coinbase/manifest.ts:5`).
- `secure-wallet.cdp.coinbase.com` — CDP embedded-wallet origin.
- `pay.coinbase.com` — Coinbase onramp embed and redirect (`apps/web/server/funding/providers/coinbase/manifest.ts:6`; rendered by `apps/web/client/funding/order-flow.tsx:685`).
- `checkout.idrx.co` — IDRX checkout redirect (`apps/web/server/funding/providers/idrx/manifest.ts:6`).
- `skala.ripio.com` — Ripio onramp API and payment redirect (`apps/web/server/funding/providers/ripio/manifest.ts:5`).
- `kyc.ripio.com` — Ripio customer KYC handoff (`apps/web/server/funding/providers/ripio/manifest.ts:6`).

Recipient-name resolution is server-side (`apps/web/server/transfers/recipient-resolver.ts`), so the browser still calls only `api.ensideas.com` for names; the resolver origin is not a new browser host.

## Live expected failures

These request failures have been observed on deployments. Inspect browser network results;
do not silently ignore a new failure or treat this list as permission to broaden origins.

- `GET https://api.cdp.coinbase.com/platform/v2/embedded-wallet-api/projects/75f1f0c7-83bf-47c7-a227-e94bb6d04f83/config` 404 — CDP SDK optional project config.

## Gaps

**Playwright Reach replay:** `apps/web/tests/browser/feature-map-replay.pw.ts` exercises the
non-manual fixture Reaches for landing, sign-in, home-panel, balances, activity, save,
invest, send, account-settings, and coverage. Manual surfaces are explicitly skipped with reasons in the test. This only checks entry
steps; it does not cover borrow markets, activity pagination, invest categories or memes,
coverage filters, or dev-ui behavior.
**Journey stories:** Only `apps/web/stories/journeys/savings-deposit.stories.tsx` exists; every other surface above lacks one.

**Reach depends on a live provider and cannot run against the fixture server** (needs a documented fixture or an authorized live agent session):
- Base-account/CDP sign-in (`client/account/base-account-connector.tsx`, `cdp-*`), real Coinbase onramp/offramp providers via `/api/funding/providers`, `/api/funding/quotes`, `/api/funding/provider-customers`, and `/api/funding/webhooks/[provider]` (smoke uses hand-written IDRX/PEER stubs instead of a documented shared fixture).
- Real Basename/ENS resolution and reverse labels: the fixture-session helper intercepts `/api/transfers/recipient-name` and `/api/transfers/recent-recipients` with static bodies, so Base L2 Basename resolution, mainnet ENS resolution, and forward-verified reverse labels (`apps/web/server/transfers/recipient-resolver.ts`) are only exercised by an authorized live agent session or a non-fixture run.
- Invest `Memes` discovery (`/api/invest/discover`) and market prices (`/api/market-prices*`) when the fixture returns `{}` — smoke never asserts a meme shelf; treat as unknown rather than "empty".
- `/api/webhooks/cdp` and trades (`/api/trades`, `client/trading/trade-actions.tsx` buttons are `disabled` — trading is not user-reachable today).

**Performance observations**: the listed initial and live mark budgets are historical baselines, not CLI gates. Read named browser performance marks if performance is in scope; explain deviations in evidence rather than claiming a pass from a static number.

**Verification notes:** every selector quoted here was read from code or from `tests/browser/*.pw.ts`. Remaining Unknowns identify provider- or fixture-dependent behavior that code alone cannot confirm. The fixture baseline and kept-current trigger set are repository policy.
