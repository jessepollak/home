# CDP SDK error reporting privacy decision

Status: reviewed September 11, 2026 for issue #74 against the installed `@coinbase/cdp-sdk@1.55.0`. No provider request was made during this review.

## Decision

Keep CDP server SDK error reporting disabled by default.

Home already enforces this in `apps/web/server/cdp/provider.ts`: unless an operator has explicitly set `DISABLE_CDP_ERROR_REPORTING=false`, the value is changed to `true` before the SDK module loads. The same default applies to `DISABLE_CDP_USAGE_TRACKING`.

This observability milestone does not change that behavior and does not authorize an operator override.

## Source review

The installed SDK source shows that, when error reporting is enabled:

- `src/client/cdp.ts` assigns the server CDP API key identifier to the analytics identifier;
- `src/analytics.ts` reads an unexpected error's raw `message` and `stack`;
- the SDK packages those fields with the method, SDK version, language, platform, and timestamp; and
- it posts the event to Coinbase's analytics endpoint.

The SDK filters some expected API and validation errors, but unexpected and network errors can still carry provider or application context. This path does not pass through Home's scrubber or closed `home.observability.v2` schema.

## Why it remains off

1. Raw exception messages and stacks do not meet Home's source-level allowlist.
2. The CDP API key identifier is attached as analytics identity.
3. The upload is a separate vendor channel from Home's Vercel runtime logs.
4. Failures could be reported twice, once through Home's scrubbed line and once through unsanitized SDK telemetry.
5. Enabling it would make the application's privacy posture depend on SDK implementation details that Home does not control.

## Operator rule

Leave `DISABLE_CDP_ERROR_REPORTING` unset or set it to `true`. Do not set it to `false` in local, preview, or production environments as part of issue #74.

Any future opt-in requires a separate review that:

- identifies the exact installed SDK version and event fields;
- proves with synthetic, credential-free tests that no tokens, OTPs, keys, provider payloads, raw URLs, or user data can leave;
- records who approved the additional vendor destination;
- verifies that Home remains correct when the reporting request fails; and
- updates this decision before changing an environment value.

Browser CDP packages are a separate surface. This document does not claim they share the server SDK implementation. Base Account telemetry remains governed by its existing disabled preference.

Home's current source-level channel is documented in [Privacy-safe observability](observability.md).
