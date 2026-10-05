# Coinbase onramp agent-browser sandbox harness

This repo-owned harness runs a guarded, headed, non-funded Coinbase Embedded Orders sandbox proof. It pauses for an operator to sign in to Home, enters only synthetic Coinbase sandbox values, performs the fake Apple Pay confirmation, and verifies Home's terminal sandbox message. This is the narrow approved provider-acceptance path, not product regression coverage or the normal interactive agent-browser workflow. It is never a funded-payment authorization.

## Prerequisites

- Node 22 or newer and this repository's pinned Bun version.
- Repository-pinned `agent-browser` **0.38.1**, installed with `bun run worktree:bootstrap`. The harness resolves only the repository binary and checks the exact package pin; never install or select a global binary. Run `bun run ab -- skills get core` for the version-matched command reference. If Chrome is unavailable, follow the [pinned browser setup](browser-validation.md#pinned-browser-and-sessions).
- A local Home server on an exact `http://localhost:<port>` origin, with migrations applied and an account the operator can sign into interactively.
- The server environment described in the [Coinbase provider README](../apps/web/server/funding/providers/coinbase/README.md#sandbox), including the application's session, database, funding-quote, CDP API and Base RPC configuration.
- `COINBASE_ONRAMP_MODE=sandbox` on that **local server only**. Sandbox still uses production CDP API credentials for provider-hosted synthetic writes. Never set this mode on production or Vercel.

Start Home separately with its local sandbox environment. The root `bun run dev` command applies migrations before starting the app; starting the server and applying migrations are operator actions, not harness actions.

## Run

Live execution is opt-in and refused in CI:

```sh
COINBASE_ONRAMP_AGENT_BROWSER_LIVE=1 bun run verify:coinbase-onramp -- --origin http://localhost:3000
```

The default origin is `http://localhost:3000`; `--origin` may be omitted for that port. No remote, HTTPS, loopback-IP, path-bearing, query-bearing or credential-bearing URL is accepted.

### Operator checkpoint

The harness pre-closes and then launches its owned **home-coinbase-onramp-sandbox** session in headed mode. When output reports `home-auth-checkpoint` as `waiting-for-human`, complete Home sign-in yourself in that window within five minutes. The script never requests, reads, prints or stores the real Home login OTP. It waits for `/home` and the **Add money** link before proceeding.

### Sandbox flow

After authentication, the harness sets `home.country.v2=US` through `storage local set`, reloads, and follows:

**Add money → Deposit USD → type $5 in Amount → Review quote → Confirm deposit → View payment instructions**.

It obtains the browser-level WebSocket URL using `get cdp-url`, maps it to the loopback HTTP origin, and reads `/json/list`. The CDP OOPIF bridge requires exactly one iframe on the exact `https://pay.coinbase.com/v3/api-onramp/embedded-order` URL with `useApplePaySandbox=true` and its own WebSocket endpoint. After connecting, it re-checks the frame's sandbox origin and query before entering any synthetic data.

Coinbase contact, hosted OTP and identity fields receive only documented/synthetic sandbox inputs: phone `+10005550199`, email `home-563@sandbox.test`, OTP `000000`, synthetic SSN last four `0000` and date of birth `01/01/1990`. Do not substitute real customer data.

Fake payment is locked behind five independent checks before the sandbox Apple Pay click and again before confirmation:

1. The top-level Home origin is the exact local origin, re-checked in the page immediately before every Home step in a single fail-fast batch.
2. Home displays **Sandbox — not a real deposit**.
3. The connected frame's current URL is still on the exact `https://pay.coinbase.com` origin with `useApplePaySandbox=true`.
4. Coinbase displays **Apple Pay Sandbox**.
5. Coinbase displays **No real funds will be used**.

Only **Apple Pay Sandbox** and the fake confirm action are permitted. The sandbox frame URL and both sandbox labels are re-verified inside the same synchronous in-frame evaluation that performs each payment click; any failed check prevents the click. Legitimate frame route changes are allowed while the exact Coinbase origin and sandbox query remain intact. Success requires Home to display **Sandbox complete — no real funds moved** within two minutes. Do not work around a guard or reuse a failed provider order.

## Output and privacy

Every stdout line is a JSON object with only `stage` and `status`, including recovery actions:

```json
{"stage":"home-auth-checkpoint","status":"waiting-for-human"}
```

Raw CLI stdout is never forwarded. Internal stdout/stderr is bounded to 32 KB. Sensitive errors are redacted and never included in summaries. Redaction covers JWTs, 40-hex wallet addresses, email addresses, phone numbers, Coinbase payment URLs/query strings, Bearer credentials, authorization/wallet-auth headers, session/user-auth/access/refresh/ID tokens, WebSocket URLs and IPv4 addresses; existing redaction markers are preserved. Surfaced summaries contain no browser content. The harness takes no screenshots or snapshots and does not read a real OTP.

## Failure recovery

Each failure emits one `failed` summary and exactly one `recovery: …` action. A separate cleanup failure has its own action.

| Failure | Recovery action |
| --- | --- |
| `optin` | Set `COINBASE_ONRAMP_AGENT_BROWSER_LIVE=1` outside CI and rerun. |
| `origin` | Rerun with `--origin http://localhost:<port>`. |
| `binary` | Run `bun run worktree:bootstrap` and rerun. |
| `version` | Run `rm -rf node_modules/agent-browser && bun install --frozen-lockfile` and rerun. |
| `node-version` | Run the harness with Node 22 or newer. |
| `argv` | Remove unsupported browser profile or state configuration and rerun. |
| `session` | Close the named harness session and rerun. |
| `auth` | Rerun and complete Home sign-in in the headed window before the checkpoint expires. |
| `home-flow` | Verify the local sandbox server environment and restart the command. |
| `cdp` | Close the named session and rerun with the pinned browser. |
| `iframe-zero` | Verify Coinbase sandbox server setup and start a new order. |
| `iframe-multiple` | Close the named session and rerun with only one Add money flow open. |
| `coinbase-screen` | Close the failed order and start a new Coinbase sandbox order. |
| `payment-guard` | Stop and rerun only after every Home and Coinbase sandbox label is visible. |
| `terminal` | Inspect local server logs, then rerun with a new sandbox order. |
| `cleanup` | Run `bun run ab -- --session home-coinbase-onramp-sandbox close` and verify it succeeds before rerunning. |
| `signal` | Rerun the command after the named session is closed. |
| `step-order` | Report the harness ordering failure before retrying. |
| `unknown` | Verify local setup and rerun the sandbox harness. |

## Cleanup and automation boundary

Cleanup closes CDP, kills active harness command process trees on POSIX (direct child processes on Windows) and waits up to five seconds for the pending browser command to settle before closing only **home-coinbase-onramp-sandbox**, then removes its private temporary config directory. A nonzero or failed named-session close emits `cleanup-named-session` failure and makes the command fail even after a successful sandbox flow. SIGINT/SIGTERM clean up once and exit 130. Never use `close --all`.

The exact local origin is asserted in the page in the same fail-fast batch immediately before every Home step, but a CLI-driven locator action cannot be made transactional with that assertion, so the harness also relies on its fresh isolated browser session (no profile, state, auto-connect or ambient `AGENT_BROWSER_*` configuration), which holds no signed-in remote origin.

The config directory is private and its empty `config.json` is mode 0600. Every ambient `AGENT_BROWSER_*` variable is removed from child environments. No profile/state is persisted or restored; the harness never auto-connects to an existing browser. It performs no direct database administration and changes no provider settings or Vercel configuration. The sandbox order it drives through Home is persisted normally in the local database. Creating the authorized local sandbox order is the only provider-write flow; removing a local sandbox proof row remains an explicit operator step under the provider README's local recovery procedure.

`node --test scripts/gates/tests/coinbase-onramp-agent-browser.test.mjs` and `bun run gates` run deterministic safety-contract tests without a browser, network or real Home server. Neither CI nor `bun check` runs this live flow. Live execution remains opt-in and outside CI; unattended Home authentication, production origins, production Apple Pay and funded payments are unsupported.
