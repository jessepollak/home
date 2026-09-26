### `sign-in`
- **Entry context**: account · `/?account=signin`, `/account` (redirect) · anonymous · `installApiFixtures` (session/OTP fixture) · header `Sign in` (shell-chrome.tsx) or goto `/?account=signin`.

- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-screen.tsx`, `apps/web/client/account/sign-in-*.tsx`, `apps/web/server/auth/**`
- **Reach**:
  1. `goto "/?account=signin"`
  2. `expect "Sign in to Home"`
- **Notes**: The smoke path installs API fixtures, fills `Email address`, presses Enter, fills `Verification code` with `123456`, clicks `Verify and continue`, and expects `/home`.
- **Expect**: dialog labelled `Sign in to Home` (client/account/account-screen.tsx); email + OTP steps; after verify `router.replace("/home")` (shell.tsx `AccountSignInSheet onVerified`). Signed-out visiting `/home`/`/save` lands on `/?account=signin` (one dashboard-route effect; `/save` asserted in routing.pw.ts, `/home` in client/home/home-experience.test.tsx).
- **States**: email step; OTP step; error/execution variants (`That code is not valid. Check the six digits and try again.`, `Try again`, and the resend countdown/`Resend code`); Base-account (CDP) connector variant (sign-in-base-account.tsx) — operator/live path.
- **Evidence**: screenshot of dialog; DOM snapshot; console/errors; marks n/a (`shell:paint` may fire on the root page).
- **Owned by**: `apps/web/client/account/{account-screen,sign-in-email,sign-in-otp,sign-in-shell,sign-in-copy}.tsx`, server `apps/web/server/auth/*` (`authorize.ts`, `render-session.ts`, `native-base-session.ts` per app/layout.tsx).
- **Unknowns**: none; the labels, invalid-code recovery, and resend countdown are defined in `sign-in-email.tsx`, `sign-in-otp.tsx`, and `account-screen.tsx`.
