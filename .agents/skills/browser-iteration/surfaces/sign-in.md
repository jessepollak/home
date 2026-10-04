### `sign-in`
- **Entry context**: account · `/?account=signin`, `/account` (redirect) · anonymous · `installApiFixtures` (session/OTP fixture) · header `Sign in` (shell-chrome.tsx) or goto `/?account=signin`.

- **Live**: read-only
- **Owned paths**: `apps/web/client/account/account-screen.tsx`, `apps/web/client/account/account-route-provider.tsx`, `apps/web/client/account/cdp-client.tsx`, `apps/web/client/account/sign-in-*.tsx`, `apps/web/client/account/email-share-sheet.tsx`, `apps/web/client/account/email-request-flow.ts`, `apps/web/server/auth/**`
- **Reach**:
  1. `goto "/?account=signin"`
  2. `expect "Sign in to Home"`
- **Notes**: The smoke path installs API fixtures, fills `Email address`, presses Enter, fills `Verification code` with `123456`, clicks `Verify and continue`, and expects `/home`.
- **Expect**: dialog labelled `Sign in to Home` (client/account/account-screen.tsx); email + OTP steps; after verify `router.replace("/home")` (shell.tsx `AccountSignInSheet onVerified`). Signed-out visiting `/home`/`/cash` lands on `/?account=signin` (one dashboard-route effect; `/cash` asserted in routing.pw.ts). Legacy `/save` redirects to `/cash/savings` before the sign-in route check.
- **States**: email step; OTP step; error/execution variants (`That code is not valid. Check the six digits and try again.`, `Try again`, and the resend countdown/`Resend code`); Base-account (CDP) connector variant (sign-in-base-account.tsx) — operator/live path; after a Base sign-in whose wallet did not return an email, the `Share your email` sheet (`Share` / `Not now`, email-share-sheet.tsx) — live path only, fixture evidence through `story:account-email-share-sheet--default` and `--right-to-left`.
- **Evidence**: screenshot of dialog; DOM snapshot; console/errors; marks n/a (`shell:paint` may fire on the root page).
- **Owned by**: `apps/web/client/account/{account-screen,account-route-provider,cdp-client,sign-in-email,sign-in-otp,sign-in-shell,sign-in-copy}.tsx`, server `apps/web/server/auth/*` (`authorize.ts`, `render-session.ts`, `native-base-session.ts` per the shell layout).
- **Unknowns**: none; the labels, invalid-code recovery, and resend countdown are defined in `sign-in-email.tsx`, `sign-in-otp.tsx`, and `account-screen.tsx`.
