# Production performance observability

Status: source-level design for issues #438 and #437, implemented September 14, 2026. Deployment settings and production verification remain operator work.

Home uses two complementary performance signals and one bounded balance-latency policy. [Vercel Speed Insights](https://vercel.com/docs/speed-insights) owns standard real-user Web Vitals. A closed Home startup event names product phases that Web Vitals cannot. Existing structured balance logs measure the server path.

## Browser signals

`@vercel/speed-insights` is mounted in the root layout at a sample rate of 1. Its `beforeSend` boundary accepts only `/` and the canonical L1 shell routes (`/home`, `/balances`, `/activity`, `/save`, `/borrow`, `/invest`), normalizes dynamic L2 paths to their L1 page label, strips query strings and hashes, retains the required HTTP origin plus pathname, and drops every other or non-absolute URL. Vercel rejects pathname-only metric `href` values as invalid HTTP URLs, so the sanitized value must remain absolute. Vercel documents the framework integration and dashboard in [Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart).

`POST /api/client-performance` accepts closed `home-startup` and `home-auth-phase` reports. The startup report's only dimensions are route (`/` or one canonical L1 page label), terminal outcome (`ready`, `signed-out`, `unavailable`, or `timeout`), cache provenance (`restored`, `cold`, or `unknown`), and bounded integer phase durations. The restore auth report adds fixed hint (`none`, `cdp`, or `base`) and outcome (`signed-out`, `verified`, `unavailable`, or `timeout`) enums plus navigation-relative SDK activation, CDP initialization, native settlement, and terminal session timings. Its `outcome` is the first settled account state: a late CDP restore after a no-hint `signed-out` settlement does not emit a second event. The signout auth report has only fixed success/error/timeout outcomes, attempted booleans, and timings for visible navigation, native logout, wallet disconnect, CDP sign-out, and total cleanup. Auth timings are rounded to 50 ms and capped at 30 seconds. The contract accepts no account, owner, wallet address, subject, identity, email, URL, query, hash, exception, error text, provider payload, or arbitrary string data.

A durable, identity-free CDP restore marker makes late restore exceptional for previously server-verified CDP sessions. With no conservative CDP evidence, Home does not mount CDP at all, so there is no unhinted refresh race or anonymous/Base-only CDP request. Exact hints activate immediately but remain non-authoritative: server verification and owner fencing are still the authentication and privacy boundaries. The current lifecycle represents a native restore outage as signed out with recovery copy, so its restore event also records the first-settled `signed-out` outcome; distinguishing that outage in telemetry is a follow-up, not authority to change the user state.

The phases are shell paint, verified session, balances painted, first primary action interaction, and total startup. Restored balances may paint before server verification; the reporter preserves that observed numeric order. Dashboard readiness requires all four phases. Landing readiness requires shell and verified session; signed-out and unavailable states terminate either route. A 15-second timer reports incomplete startup when shell paint has occurred. If the timer expires before `shell:paint`, including when a hidden tab suspends animation-frame paint, the recorder terminates without emitting because the closed schema requires `shellMs`; later visible-tab marks are ignored rather than producing a misleading late `ready`. This hidden-tab case and documents unloaded before keepalive delivery are known undercounts, so Speed Insights page views remain the denominator check. Delivery is best effort with `keepalive`, omitted credentials, and `no-store`; it never blocks rendering.

The ingestion route retains the client-error endpoint's security posture but has a separate limiter: exact same origin, JSON without content encoding, a streaming 2 KiB body bound, no-store responses, fixed-window shedding, and sink failure isolation. Its 60-report/minute per-instance budget accounts for startup plus restore and occasional signout phase reports without changing the client-error bucket. It emits `home.observability.v2`. For `kind=home-startup`, ready and signed-out are info; for `kind=home-auth-phase`, verified and signed-out are info. Unavailable and timeout outcomes are errors. `/api/client-errors` is unchanged.

## Balance latency policy

A fresh stored observation is served immediately even when it has an enumeration cursor. A hot row refreshes the registry only and preserves catalog rows and cursor. Explicit stale signals and the 120-second backstop resume full observation from the stored cursor and merge progress as before.

CDP enumeration starts pages only inside a 2.5-second soft budget. A page that started while the budget was open may finish successfully after it closes. Each in-flight page, including retries, has a four-second hard ceiling. Successful rows and the advanced cursor are retained; unavailable enumeration preserves prior rows and cursor. This trades foreground catalog completion speed for predictable response latency without changing truthful coverage.

## Production verification

After deployment, enable Speed Insights for the `home-web` Vercel project. This hosted setting can affect usage and is not changed by source code.

In Vercel logs, search `home.observability.v2`, then use:

- `kind=home-startup` and `outcome` for startup success, failure, and undercount checks;
- `kind=home-auth-phase flow=restore hint=none outcome=signed-out` with `totalMs` for anonymous p50/p95; after at least 50 events, target p50 below 1.5 seconds and p95 below 3 seconds;
- `kind=home-auth-phase flow=restore` grouped by `hint` and `outcome` to keep CDP-hinted restore separate, and compare `nativeSettledMs`, `cdpInitializedMs`, and `sessionSettledMs` to locate delay;
- browser Network recordings for clean `/`, clean `/home`, and a Base-only restore: confirm zero CDP config, MFA, and refresh requests; then repeat with each exact restore hint and email submit to confirm one SDK activation;
- `kind=home-auth-phase flow=signout` grouped by `outcome`: compare `visibleNavigationMs` (target p50 below 1 second and p95 below 2.5 seconds) with native, wallet, CDP, and total timings; verify attempted booleans match clean Base-only versus known-CDP sessions;
- a native/Base logout Network recording: confirm landing navigation follows successful native logout while bounded CDP cleanup can remain in flight, and confirm no `/` to `/home` bounce;
- `kind=home-auth-phase outcome=timeout` for incomplete restore rate (partial phase fields show the last fixed milestone reached);
- `kind=balances-read` and `outcome=served-row` for warm-read ratio;
- `kind=balances-read` with `durationMs.total` and `durationMs.enumerate` for p50/p75/p95 and removal of the eight-second mode;
- `kind=portfolio-balance-source` for incomplete or unavailable enumeration reason and page count.

Verify after at least 200 balance reads or seven days, whichever is later. Capture warm versus cold distributions, catalog coverage, unavailable/stale rates, `/home` startup split by cache provenance, and Speed Insights LCP/INP for only `/` and the canonical L1 labels. Runtime log retention is plan-dependent, so record the before/after summary on the tracking issues during that window.

## Rollback

Speed Insights and the Home startup reporter are independent additive signals. Remove or lower Speed Insights sampling if its traffic is unsuitable; remove the custom reporter independently if its endpoint traffic is unsuitable. If catalog convergence is too slow, cursor-driven foreground resume may be restored while retaining the soft page-start and hard in-flight-page bounds. Do not restore the eight-second whole-scan abort without new production evidence.
