### `landing`
- **Entry context**: home · `/` · anonymous (signed-in 307 → `/home`, app/page.tsx) · none (`SupportedGlobeDynamic`) · goto `/`.

- **Live**: read-only
- **Owned paths**: `apps/web/app/page.tsx`, `apps/web/client/landing/**`, `apps/web/client/home/shell-chrome.tsx`
- **Reach**:
  1. `goto "/"`
  2. `expect "One home for your money."`
- **Notes**: Optionally use a 900×844 viewport for the pointer-fine layout used by smoke.
- **Expect**: `h1` `One home for your money.` (client/home/shell-chrome.tsx, `landing-title`); subtitle `Invest in any asset, earn more on your savings, and grow your wealth.` (same file); buttons `Sign in` and, when `account.signInAvailability === "ready"`, `Create account` (shell-chrome.tsx); header `Sign in` in `role="banner"` (tests/browser/mobile-geometry.pw.ts "wide touch targets…" test); globe visual `SupportedGlobeDynamic` (app/page.tsx). Signed-in request 307s to `/home` (tests/browser/landing-route.pw.ts).
- **States**: anonymous default; `isVerified` landing variant swaps in `Open dashboard` (shell-chrome.tsx); `sign-out-error` variant shows destructive Alert with `Retry sign out`.
- **Evidence to capture**: screenshot (mobile + desktop); DOM text snapshot; console errors + failed requests (expected none; the globe renderer uses a local dynamic import and makes no application network request); perf marks: `shell:paint` fires here too (client/home/shell.tsx rAF), but `balances:painted`/`session:verified` are dashboard-only.
- **Perf budgets (initial)**: `shell:paint` ≤ 1_500 ms.
- **Owned by**: `apps/web/client/landing/`, `apps/web/client/home/shell-chrome.tsx`, `apps/web/client/home/shell.tsx`, `apps/web/app/page.tsx`.
- **Unknowns**: none; `supported-globe.tsx` only dynamically imports the local renderer and does not fetch remote data.
