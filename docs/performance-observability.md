# Production performance observability

Status: source-level design for issues #438 and #437, implemented September 14, 2026. Deployment settings and production verification remain operator work.

Home uses two complementary performance signals and one bounded balance-latency policy. [Vercel Speed Insights](https://vercel.com/docs/speed-insights) owns standard real-user Web Vitals. A closed Home startup event names product phases that Web Vitals cannot. Existing structured balance logs measure the server path.

## Browser signals

`@vercel/speed-insights` is mounted in the root layout at a sample rate of 1. Its `beforeSend` boundary accepts only `/` and `/dashboard`, strips query strings and hashes, retains the required HTTP origin plus pathname, and drops every other or non-absolute URL. Vercel rejects pathname-only metric `href` values as invalid HTTP URLs, so the sanitized value must remain absolute. Vercel documents the framework integration and dashboard in [Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart).

`POST /api/client-performance` accepts one closed `home-startup` report per document. The only dimensions are route (`/` or `/dashboard`), terminal outcome (`ready`, `signed-out`, `unavailable`, or `timeout`), cache provenance (`restored`, `cold`, or `unknown`), and bounded integer phase durations. It accepts no account, owner, wallet, subject, provider, URL, query, hash, exception, or arbitrary string data.

The phases are shell paint, verified session, balances painted, first primary action interaction, and total startup. Restored balances may paint before server verification; the reporter preserves that observed numeric order. Dashboard readiness requires all four phases. Landing readiness requires shell and verified session; signed-out and unavailable states terminate either route. A 15-second timer reports incomplete startup when shell paint has occurred. If the timer expires before `shell:paint`, including when a hidden tab suspends animation-frame paint, the recorder terminates without emitting because the closed schema requires `shellMs`; later visible-tab marks are ignored rather than producing a misleading late `ready`. This hidden-tab case and documents unloaded before keepalive delivery are known undercounts, so Speed Insights page views remain the denominator check. Delivery is best effort with `keepalive`, omitted credentials, and `no-store`; it never blocks rendering.

The ingestion route retains the client-error endpoint's security posture but has a separate limiter: exact same origin, JSON without content encoding, a streaming 2 KiB body bound, no-store responses, fixed-window shedding, and sink failure isolation. It emits `home.observability.v2` with `kind=home-startup`; ready and signed-out are info, while unavailable and timeout are error. `/api/client-errors` is unchanged.

## Balance latency policy

A fresh stored observation is served immediately even when it has an enumeration cursor. A hot row refreshes the registry only and preserves catalog rows and cursor. Explicit stale signals and the 120-second backstop resume full observation from the stored cursor and merge progress as before.

CDP enumeration starts pages only inside a 2.5-second soft budget. A page that started while the budget was open may finish successfully after it closes. Each in-flight page, including retries, has a four-second hard ceiling. Successful rows and the advanced cursor are retained; unavailable enumeration preserves prior rows and cursor. This trades foreground catalog completion speed for predictable response latency without changing truthful coverage.

## Production verification

After deployment, enable Speed Insights for the `home-web` Vercel project. This hosted setting can affect usage and is not changed by source code.

In Vercel logs, search `home.observability.v2`, then use:

- `kind=home-startup` and `outcome` for startup success, failure, and undercount checks;
- `kind=balances-read` and `outcome=served-row` for warm-read ratio;
- `kind=balances-read` with `durationMs.total` and `durationMs.enumerate` for p50/p75/p95 and removal of the eight-second mode;
- `kind=portfolio-balance-source` for incomplete or unavailable enumeration reason and page count.

Verify after at least 200 balance reads or seven days, whichever is later. Capture warm versus cold distributions, catalog coverage, unavailable/stale rates, `/dashboard` startup split by cache provenance, and Speed Insights LCP/INP for only `/` and `/dashboard`. Runtime log retention is plan-dependent, so record the before/after summary on the tracking issues during that window.

## Rollback

Speed Insights and the Home startup reporter are independent additive signals. Remove or lower Speed Insights sampling if its traffic is unsuitable; remove the custom reporter independently if its endpoint traffic is unsuitable. If catalog convergence is too slow, cursor-driven foreground resume may be restored while retaining the soft page-start and hard in-flight-page bounds. Do not restore the eight-second whole-scan abort without new production evidence.
