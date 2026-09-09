# CDP error reporting — privacy review

Status: written decision for #74. Default stays disabled. This PR does **not** set `DISABLE_CDP_ERROR_REPORTING=false`.

## Decision

**Keep CDP server SDK error reporting off** (`DISABLE_CDP_ERROR_REPORTING=true`, also the implicit default when unset). Home already applies that default in `apps/web/server/cdp/provider.ts` before `@coinbase/cdp-sdk` loads. Usage tracking stays off the same way (`DISABLE_CDP_USAGE_TRACKING`).

Reviewed against `@coinbase/cdp-sdk@1.55.0` (`src/analytics.ts`, `src/client/cdp.ts`) and [CDP TypeScript SDK docs](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/typescript).

## What enabling would send

When the flag is not `"true"`, the SDK POSTs to `https://cca-lite.coinbase.com/amp` (Coinbase analytics, not Vercel):

| Field | Source |
|---|---|
| `user_id` | `Analytics.identifier` = the operator **CDP API key id** |
| `message` | raw `Error.message` |
| `stack` | raw `Error.stack` |
| `method` | SDK method name |
| SDK version / language | constants |

It skips most `APIError` values and user-input validation errors. It **does** send `NetworkError` and unexpected errors.

## Why this is not safe to enable yet

1. **Leaves Vercel-first.** Jesse locked 1+2+4 to Vercel Observability. CDP reporting is a second vendor path.
2. **No Home scrubber on that channel.** Stacks and messages can include provider text. Home maps auth failures to `UNAUTHENTICATED` / `AUTH_UNAVAILABLE` for API clients; the SDK would upload the pre-map error.
3. **API key id as `user_id`.** Not an end-user OTP, but a credential identifier Home should not ship to a third party by default.
4. **Double-send.** Auth/money failures would already have a scrubbed `home.observability.v1` line. Enabling CDP would duplicate them without the same allowlist.

## When (if ever) to set `false`

Only after all of:

1. Jesse (or the fork operator) accepts Coinbase receiving API key id + raw SDK stacks.
2. A probe shows `validateAccessToken` / trade / SQL errors do not include access tokens, OTPs, or Authorization material.
3. Vercel logs are the primary search path; CDP is optional vendor telemetry, not the pager.
4. The override is an explicit env value on that operator’s project — never a new Home default.

Until then, leave the variable unset or `true` in Vercel and `.env.example`. Do not “try it on preview.”

Browser `@coinbase/cdp-core` / hooks telemetry is a separate follow-up. Base Account already sets `preference: { telemetry: false }`.

Operator setup: [CDP setup](cdp-setup.md). Vercel env table: [Vercel deploy](vercel-deploy.md).
