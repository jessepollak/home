# Coinbase Onramp agent-browser sandbox harness

This runbook covers the repo-owned, non-funded Coinbase Embedded Orders sandbox proof. It opens a visible browser, pauses for a human to sign in to Home, enters only Coinbase's documented synthetic sandbox values, performs the fake Apple Pay confirmation, and verifies Home's terminal sandbox message.

## Status and prerequisites

Live success depends on the application change in [#562](https://github.com/jessepollak/home/pull/562). Until #562 is merged into the branch being tested, use this harness only for its unit/gate tests. Do not copy that PR into this branch.

The harness requires:

- Node 22 or newer and this repository's pinned Bun version;
- `agent-browser` 0.21.0 or newer installed outside this repository;
- a locally running Home server at an exact `http://localhost:<port>` origin;
- the local server environment described in the Coinbase provider README: `HOME_SESSION_SECRET`, `DATABASE_URL`, `FUNDING_QUOTE_SECRET`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `BASE_RPC_URL`;
- `COINBASE_ONRAMP_MODE=sandbox` on the local server only; and
- migrations applied and a Home account that the operator can sign into interactively.

Install the external browser tool and its browser binary, for example:

```sh
npm install -g agent-browser
agent-browser install
agent-browser --version
```

If the executable is not on `PATH`, set `HOME_AGENT_BROWSER_BIN` to its absolute path for the harness process. That setting selects the executable only; it is not forwarded as `AGENT_BROWSER_*` browser configuration.

Start Home separately with its local sandbox environment. The root development command applies migrations before starting the web app:

```sh
bun run dev
```

Never put `COINBASE_ONRAMP_MODE` on Vercel or any production environment.

## Run

Live execution is deliberately opt-in and refused in CI:

```sh
COINBASE_ONRAMP_AGENT_BROWSER_LIVE=1 bun run verify:coinbase-onramp -- --origin http://localhost:3000
```

The default origin is `http://localhost:3000`, so `--origin` may be omitted for that port. No remote, HTTPS, loopback-IP, path-bearing, or credential-bearing URL is accepted.

The command pre-closes and then launches the harness-owned `home-coinbase-onramp-sandbox` session in headed mode. When output reports the Home auth checkpoint as waiting, complete sign-in yourself in that visible window. The script never requests, accepts, reads, prints, or saves the real Home login OTP. It waits, with a five-minute bound, for `/home` and the **Add money** button.

After authentication, the harness sets `home.country.v1=US` through `agent-browser storage local set`, reloads, and drives a $5 Home sandbox order. It discovers exactly one matching Coinbase out-of-process iframe over the session's loopback CDP endpoint. Coinbase contact, hosted OTP, and identity fields receive only documented/synthetic constants: a `+1000…` phone, an `@sandbox.test` email, `000000`, and synthetic SSN-last-four/date-of-birth values.

Fake payment confirmation remains locked behind all five independent checks:

1. the top-level Home origin is the exact local origin;
2. Home displays **Sandbox — not a real deposit**;
3. the exact Coinbase Embedded Orders iframe URL has `useApplePaySandbox=true`;
4. the iframe displays **Apple Pay Sandbox**; and
5. the iframe displays **No real funds will be used**.

The only permitted payment action is the sandbox Apple Pay click and fake confirmation. Success requires Home to display **Sandbox complete — no real funds moved**.

## Output and privacy

Every stdout line is a JSON object with only these keys:

```json
{"stage":"home-auth-checkpoint","status":"waiting-for-human"}
```

Raw `agent-browser` output is never forwarded. Bounded internal errors redact JWTs, exact wallet addresses, email addresses, long phone numbers, Coinbase payment URLs and query strings, session tokens, WebSocket URLs, and IPv4 addresses. The harness never invokes screenshots or snapshots.

## Failure recovery

Each failure emits one `failed` summary followed by exactly one `recovery: …` action. Common recoveries are:

| Failure | Recovery |
| --- | --- |
| Missing binary or unknown version | Install `agent-browser`; set `HOME_AGENT_BROWSER_BIN` when it is not on `PATH`. |
| Version older than 0.21.0 | Upgrade `agent-browser`, then rerun. |
| Auth checkpoint timeout | Rerun and complete Home sign-in in the headed window before five minutes. |
| No matching Coinbase iframe | Merge #562, verify the local sandbox server environment, and create a new order. |
| Multiple matching iframes | Close the named session and rerun with one Add money flow. |
| Unexpected Coinbase screen | Close the failed order and start a new sandbox order. |
| Sandbox guard failure | Stop; rerun only when all five sandbox indicators are visible. |
| Home terminal timeout | Inspect local Home server logs, then rerun with a new sandbox order. |

Do not work around a guard, reuse a failed provider order, or substitute real customer data.

## Cleanup and automation boundary

The `finally` path closes only `home-coinbase-onramp-sandbox`. It does not save a browser profile/state, inspect existing auth state, delete database rows, alter provider/CDP settings, or touch Vercel. If a local sandbox row must be removed before another attempt, that remains an explicit operator action using the local database procedure appropriate to the development environment.

`bun run gates` runs deterministic tests for the safety contracts but does not launch a browser. Neither CI nor `bun check` executes the live provider flow. This harness is sandbox-only: it does not support a funded payment, production origin, production Apple Pay, database cleanup, or unattended Home authentication.
