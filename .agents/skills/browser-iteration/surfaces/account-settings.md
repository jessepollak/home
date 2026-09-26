### `account-settings`
- **Entry context**: account · `/?account=settings` (dashboards commit `?account=settings`, shell.tsx `openAccountSettings`) · signed-in verified · signed-in seed · header profile mark (`ProfileMark`, shell-chrome.tsx) → settings; or goto `/home?account=settings`.

- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`, `apps/web/client/home/use-show-small-balances.ts`
- **Reach**:
  1. `goto "/home?account=settings"`
  2. `expect "Account"`
- **Notes**: The fixture-session helper seeds signed-in state and fixtures. The Chromium smoke opens the header profile mark with the keyboard, asserts focus enters the settings region, closes through Done and browser Back, restores the exact opener, exercises deep-link and forward-history entry, and verifies every primary-navigation `aria-controls` target remains unique and present. Live: Peer availability varies by deployment and corridor (`PEER_OFFRAMP_ENABLED`, `apps/web/server/funding/providers/peer/manifest.ts`). Production exposed the Cash App path and a live review on 2026-09-24; snapshot current provider availability rather than assuming it is off.
- **Expect**: region `aria-label="Account settings"` receives programmatic focus without selecting an input; `Show small balances` switch (`getByRole("switch", { name: "Show small balances" })`, mobile-geometry.pw.ts; owned by client/home/use-show-small-balances.ts + account-settings region of shell-panels.tsx). Sign-out control and region selector live here (shell-panels.tsx passes `regionId`, `resolutionSource`, `onRegionChange`, `onSignOut` to client/account/account-settings.tsx).
- **States**: preference not ready (`isPreferenceReady`); region override messages (`preferenceMessage`).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/client/account/account-settings.tsx`, `apps/web/client/home/shell-panels.tsx`.
- **Unknowns**: none; the country selector is described by `Country` / `Sets how money is shown`, and the button is labelled `Sign out`.
