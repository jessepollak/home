# Agentic testing pilot

Evaluate TesterArmy `e2e` against Home behavior before removing coverage. [Issue #1907](https://github.com/jessepollak/home/issues/1907) owns this migration.

The objective is reliable regression detection at a useful feedback cost. Test count, framework allegiance and a prescribed testing pyramid are not objectives. Choose the cheapest observing layer that catches a meaningful failure. Preserve exact deterministic oracles for amounts, recipients and dispatch counts even when an agent drives the interface.

## Run

Use a dedicated credential-free worktree with Bun 1.3.12 and Node 22.12 or later. The runner refuses app dotenv files because Next would load them despite the sanitized child environment. Browser requests are restricted to the fixture server's loopback port. The app process receives fixture flags and only the runner's minimal process environment, not model/provider credentials.

```sh
bun run worktree:bootstrap
npm ci --prefix tests/agentic
cd tests/agentic
npx --no-install playwright install chromium
node ../../apps/web/node_modules/typescript/bin/tsc -p tsconfig.json
npm test -- --no-cache
npm run test:mutations
```

For the fresh-agent comparison, explicitly configure `HOME_E2E_MODEL` to a Gateway model slug and `AI_GATEWAY_API_KEY` to a dedicated pilot credential. There is no default model or provider fallback. Apply a usage budget to that credential; each act step is limited to twelve actions and twelve model calls, which are not dollar limits.

```sh
npm run test:agent -- --no-cache --repeat-each 3 --output .e2e/fresh-agent
npm run test:mutations -- --agent
```

The manual `Agentic testing pilot` workflow runs scripted comparisons by default. Enabling its agent input uses repository secrets `HOME_E2E_MODEL` and `HOME_E2E_GATEWAY_API_KEY`. It adds no required CI gate or automatic PR model spend. Reports and failure traces are retained for seven days.

If the bundled browser cannot be installed, `HOME_E2E_CDP_URL` accepts only an HTTP loopback endpoint for a dedicated disposable Chromium instance. Never connect a personal or signed-in browser. Record its actual version; an older browser does not validate the new bundled Chromium. The operator owns this optional browser's cleanup; the runner owns fixture-server and attempt-context cleanup.

## Shared journeys and faults

Both drivers run the same journeys and assertions at a 390×844 viewport:

| Journey | Observable outcome |
| --- | --- |
| Fund | First Add money tap opens the flow; exactly one IDRX Mandiri quote request carries 20000 IDR; review shows 20000 IDRX; instructions reach a fixture receipt. |
| Save | 0.1 USDC reaches deposit review with the exact amount and network fee; stops before confirm. |
| Send | 1 USDC to the fixed fixture recipient reaches review; synthetic first failure recovers, dispatch count stays one, reload cannot reconfirm. |

The agent drives selected navigation and input steps. Setup, confirms, recovery and all oracles remain scripted. This is a bounded comparison, not fully autonomous acceptance.

The mutation wrapper requires all three baseline journeys to pass without skips or retries, then requires each fault to fail at its intended assertion with complete cleanup and no secondary errors. Unique report directories prevent old failure reports from being reused.

| Seeded fault | Oracle |
| --- | --- |
| `funding-first-tap` | Blocks Add money clicks; the dialog must still open. |
| `funding-wrong-amount` | Types 99999 while the static quote still shows 20000; exact outgoing request must reject it. |
| `send-duplicate-dispatch` | Increments the synthetic fixture dispatch counter; the count must stay one. |

These faults test the pilot's sensitivity. The dispatch fault is a synthetic counter mutation, not a real duplicate broadcast. Mocked sessions, quotes, confirms and receipts do not prove production authentication, provider behavior, server idempotency or live-money correctness.

## Replacement decision

Before deleting tests, compare repeated scripted, fresh-agent and strict replay runs at the same commit. Record wall time, startup time, flake rate, model calls, token usage and cost. Strict read-only replay is not a promise of zero model calls. No replay cache is committed or distributed by this pilot.

Expand fault coverage to wrong recipients, authorization rejection, owner switches and ambiguous provider outcomes. Map every proposed deletion to a behavior that the replacement observes. Validate the upgraded bundled browser in CI and retain production navigation evidence where optimized Next behavior matters. Remove redundant tests only after these results support replacement; there is no permanent sole-framework restriction.

The initial local scripted comparison and three fault checks passed using cached Chromium 140 with Playwright 1.63. An intermittent development `/home` 404 was observed on repeated runs; it was not retried inside the tests and remains a reliability limit. Live-agent reliability/cost and bundled Chromium 153 remain unverified. Existing tests and required smoke are retained.
