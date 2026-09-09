# Observability (Vercel-first stub)

Status: draft spike for #74. Hope DX polish waits until Hannah’s eng review of the shape. Not a production authorization.

Home stays on the existing Vercel Pro team. This spike does **not** add Sentry, Datadog, or a log warehouse.

## What is live in this draft

| Surface | What lands |
|---|---|
| Server traces | `@vercel/otel` via `apps/web/instrumentation.ts` (`serviceName: home-web`) |
| Unhandled server exceptions | Next `onRequestError` → one JSON line in Vercel runtime logs |
| Unhandled client exceptions | `instrumentation-client.ts` → `POST /api/client-errors` → one JSON line |
| Critical API routes | One JSON line per request: `route`, `status`, `errorCode` when the response has `{ error: { code } }`, `accountProvider` when the `X-Home-Account-Provider` header is an allowlisted value |

Instrumented routes: `/api/session`, `/api/activity`, money-action `/api/actions/*` and `/api/operations`, `/api/borrow`, `/api/savings/actions`, `/api/trades`, `/api/trades/:id/finalize`, `/api/funding/onramp-session`.

Schema id: `home.observability.v1`. Example failure:

```json
{"schema":"home.observability.v1","kind":"request","route":"GET /api/activity","status":502,"errorCode":"ACTIVITY_UNAVAILABLE","accountProvider":"cdp-embedded","level":"error"}
```

## Scrub rules

Never log OTPs, access tokens, JWTs, Authorization/Cookie headers, CDP payloads, API keys, or emails. Query strings are stripped from routes. Success JSON bodies are not parsed (they contain account addresses). Client reports omit credentials (`credentials: "omit"`) and reject extra JSON keys.

Helpers: `apps/web/features/observability/scrub.ts`.

## How to query Vercel logs

Dashboard: Project → Logs. Filter production or a preview. Search `home.observability.v1`, a route (`GET /api/activity`), or an `errorCode` (`ACTIVITY_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `UNHANDLED`, `CLIENT_EXCEPTION`).

CLI (from a machine already linked to the project):

```sh
vercel logs --environment production --since 1h --query "home.observability.v1"
vercel logs --environment production --since 1h --query "ACTIVITY_UNAVAILABLE"
vercel logs --environment production --status-code 5xx --since 1h --json
```

Traces: Vercel Observability → Traces after `@vercel/otel` is on the deployment.

## Alerts (follow-up)

Do not invent a pager in-repo. After this lands, configure Vercel Observability alerts on the Pro team for 5xx spikes on `/api/activity`, `/api/session`, and `/api/actions`. Until that dashboard step exists, search the queries above.

## Follow-up (not in this draft)

- Route-level Vercel alert rules
- Structured logs on remaining private reads (`/api/portfolio`, savings positions)
- Next `error.tsx` reporting (user-visible fallback; skip until Holly/Hazel)
- Log drains / warehouse only if Vercel search is insufficient
- Hope operator tutorial beyond this stub

CDP SDK error reporting stays off: [CDP error reporting review](cdp-error-reporting.md).
