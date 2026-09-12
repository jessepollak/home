# Privacy-safe observability foundation

Status: source-level milestone for issue #74, implemented September 11, 2026. This is not a deployment or production-verification claim.

Home's first observability milestone is deliberately scrub-first. It provides a closed JSON error schema, one Next.js owner for unhandled server errors, and a bounded same-origin client-error channel. Existing product API routes are not wrapped in this pass.

## What is in the source tree

| Surface | Source | Behavior |
|---|---|---|
| Shared scrubber | `apps/web/shared/observability/scrub.ts` | Removes credentials, tokens, email addresses, raw URLs, query/hash data, risky path segments, and high-entropy strings before a value can enter the schema |
| Closed log schema | `apps/web/server/observability/schema.ts` | Emits only `home.observability.v2` fields; arbitrary objects and provider payloads are not accepted. Portfolio inventory may emit only the fixed source/stage/outcome/reason enums for degraded CDP or configured-RPC reads. |
| JSON writer | `apps/web/server/observability/log.ts` | Writes one JSON line and swallows sink failures |
| Server error owner | `apps/web/instrumentation.ts` → `onRequestError` | Uses the route template, method, route type, and sanitized error class only; it never reads the exception message, stack, digest, request URL, or headers |
| Client reporter | `apps/web/instrumentation-client.ts` | Installs before hydration, sends at most five reports per page, omits credentials and referrer, and never affects application behavior |
| Client ingestion | `POST /api/client-errors` | Requires exact same origin and JSON, limits the body to 2 KiB while streaming, rejects unknown fields, and applies a 30-report/minute per-instance shedding limit |

Example log line:

```json
{"schema":"home.observability.v2","level":"error","kind":"client-error","route":"/activity","code":"CLIENT_ERROR","errorName":"TypeError","summary":"Client error"}
```

## Frozen source-level security matrix

The focused tests lock the following contract:

| Boundary | Accepted | Rejected or removed before logging |
|---|---|---|
| Event schema | Known event kind and fixed scalar fields | Unknown fields, arbitrary objects, raw provider payloads |
| Routes | Bounded same-app pathname / route template | Absolute or protocol-relative URLs, query strings, hashes, encoded or high-entropy path segments |
| Secrets | None | Authorization/Basic/Bearer values, cookies, API keys, CDP secrets, access/refresh/id/session tokens, passwords, passcodes, PINs, OTPs, private keys, JWTs, emails, and high-entropy credential-like values |
| Server exceptions | Sanitized error class only | Message, stack, digest, cause, request URL, headers, and attached provider data |
| Client request origin | Exact request origin; optional `Sec-Fetch-Site` must be `same-origin` | Missing, `null`, malformed, cross-origin, and cross-site origins |
| Client media/body | `application/json`, no content encoding, maximum 2,048 bytes | Wrong type, encoded, empty, malformed UTF-8/JSON, declared or streamed oversize bodies |
| Client JSON | Exactly `name`, `message`, `route` with bounded strings | Missing, extra, wrongly typed, or oversized fields |
| Abuse behavior | Five sends per page; 30 accepted read attempts/minute per server instance | Excess reports shed with `429`; rejected origin/type/declared-size requests are not read |
| Failure isolation | Sink/network/installation failures are swallowed | Application startup, hydration, and endpoint success never depend on reporting |

Tests: `shared/observability/scrub.test.ts`, `client/observability/client-reporter.test.ts`, `server/observability/schema.test.ts`, `server/observability/log.test.ts`, `server/observability/on-request-error.test.ts`, and `app/api/client-errors/route.test.ts`.

## OpenTelemetry posture

`@vercel/otel` is installed and initialized only in the Node runtime, but source-level trace sampling is explicitly `always_off` and package fetch instrumentation is empty. This prevents framework span names, attributes, events, exception data, and outbound URLs from leaving through a channel that has not yet passed the same scrub contract. Enabling trace export requires a separately reviewed span processor with a closed attribute/event allowlist.

This milestone therefore produces structured runtime error logs, not exported application traces.

## Operator use

In Vercel project logs, search for the exact schema identifier `home.observability.v2`, then narrow by `kind`, `code`, `route`, or `errorName`. Balance diagnosis uses `kind=portfolio-balance-source` plus the closed `source`, `stage`, `outcome`, and `reason` fields; it contains no account, contract, quantity, request, or provider payload. Treat these lines as error signals, not user or transaction records. Do not add request headers, bodies, wallet addresses, provider responses, or exception objects to the schema.

The client endpoint's fixed-window limiter is intentionally per runtime instance. It bounds source-level work but is not a global distributed rate limit. Vercel platform request controls remain the appropriate outer abuse boundary.

## Remaining route-wrapper gate

Request status/error-code logs for existing critical API routes are intentionally deferred. The next focused pass must:

1. choose an allowlisted route identifier rather than a raw URL;
2. avoid reading successful response bodies;
3. parse only a bounded, cloned error envelope when a route already returns one;
4. preserve streaming, headers, status, and handler exceptions exactly;
5. prove no duplicate line is emitted when `onRequestError` owns an unhandled failure; and
6. edit route files only after their active ownership lanes are clear.

Until that gate passes, do not restore the route wrappers from reverted PR #78.

CDP vendor reporting remains disabled by default; see [CDP error reporting](cdp-error-reporting.md).
