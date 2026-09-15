# Base Account sign-in

Status: one Home-native mechanism with one-approval SIWE support as of issue #408 (September 13, 2026). Real Base Account compatibility still requires a manual user smoke with the intended wallet.

Home can show **Continue with email** and **Continue with Base Account** together in the existing sign-in sheet. Email authenticates through CDP when `NEXT_PUBLIC_CDP_PROJECT_ID` is configured. Base Account always uses Home-native SIWE, regardless of CDP configuration, and is available only when `HOME_SESSION_SECRET` is configured with at least 32 characters.

During a Base Account attempt the sign-in sheet stays open: connection, signing, and verification progress appears once, inside the Base Account button, while the conflicting email controls are disabled. Closing the sheet is the only cancellation action; the Close button, Escape key, and swipe gesture all use the same handler to cancel the pending attempt, close the sheet, and restore focus. There is no separate handoff overlay or modal.

## Security boundary

The Home-native Base Account flow:

1. requests `POST /api/auth/base/nonce` before connecting. The request is address-independent and returns the complete five-minute challenge: a 48-character lowercase hexadecimal nonce, Base chain ID `8453`, current domain and origin URI, SIWE version `1`, `Sign in to Home.`, issue time, and expiration time;
2. stores the same server-issued fields and request origin in a signed, HttpOnly version-2 `home-auth-challenge` cookie. The cookie contains no address or message hash;
3. switches to Base and calls viem's ERC-7846 `wallet_connect` with the challenge as the `signInWithEthereum` capability against the `@base-org/account` provider;
4. accepts exactly one connected account and an explicit message/signature proof. A supported wallet therefore connects and signs in one approval, without `eth_requestAccounts` or `personal_sign`;
5. uses the legacy `personal_sign` path only when the wallet explicitly reports `4200`, `-32601`, or `-32004`. A capability-level unsupported result retains the account returned by `wallet_connect`; a method-level unsupported result uses `eth_requestAccounts`. Missing, malformed, ambiguous, unauthorized, or otherwise unexpected capability results fail closed rather than falling back; and
6. submits `{ address, message, signature }` to `POST /api/auth/base/verify`. The server requires the normalized body address to equal the parsed SIWE address, requires every issued challenge field exactly, rejects unissued `notBefore`, `requestId`, and `resources`, and permits a SIWE scheme only when it matches the request protocol. It then verifies the signature with viem against Base and issues the signed Home session.

User rejection codes `4001` and `5000` are cancellations. A failure after a successful `wallet_connect` triggers best-effort provider disconnect. Provider calls do not retry the approval or `personal_sign` request.

The session subject derives from the verified, lowercased address. The browser's connected address is not session authority: it must be present in the signed message, in the verify body, and in the successful server verification. Verification resolves smart-account signatures through ERC-1271 and ERC-6492 in viem and fails closed if the signature cannot be verified. Home creates no authentication database row; the signed challenge is the only nonce state. A version-1, expired, wrong-TTL, origin-mismatched, or tampered challenge cookie is rejected.

The challenge remains intentionally stateless. Single-use is enforced by the browser dropping the challenge cookie after verify plus the five-minute TTL, not by server-side nonce consumption. A party already holding the valid HttpOnly cookie can replay it within that TTL, matching the existing stateless replay decision.

A Bearer-validated CDP profile can create only a `cdp-embedded` email session. Requests whose explicit or restored CDP profile resolves to `base-account` receive `403 BASE_ACCOUNT_DISABLED`; Home never derives a Base Account session from a CDP token.

Account or chain changes during connection, signing, or verification invalidate the connector and hide the session. `POST /api/auth/base/logout` requires a same-origin request and clears `home-session`, `home-auth-challenge`, `home-cdp-session`, and `home-cdp-live`.

## CDP render hint

A successful Bearer-validated email session with a Base smart account also receives a 24-hour render-hint pair signed by `HOME_SESSION_SECRET`: HttpOnly `home-cdp-session` contains the validated session and a nonce, while readable `home-cdp-live` contains the same nonce. Both halves must be present and valid. The hint has no API authority; private API routes still require a fresh CDP access token. Server Components read a valid Home session first and then the hint, so a signed-in visit to `/` redirects before rendering to `/dashboard` while `/?account=signin` remains a loop-breaking sign-in destination.

## Operator setup

1. Set `HOME_SESSION_SECRET` to at least 32 characters in every environment where Base Account sign-in or CDP render hints should work. Keep it server-only; never use a `NEXT_PUBLIC_` prefix.
2. Configure `BASE_RPC_URL` when the deployment should use a dedicated Base mainnet RPC. Local development may use the documented public fallback.
3. Configure `NEXT_PUBLIC_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, and `CDP_API_KEY_SECRET` only for email sign-in. Base Account does not require CDP SIWE, a CDP SIWE allowlist, or a separate public feature flag.
4. `DATABASE_URL` is not required for authentication itself because the flow is stateless.
5. Rotating `HOME_SESSION_SECRET` signs users out of Home-native sessions and invalidates existing render hints.

## Manual user smoke

No automated agent should perform this smoke because it opens a real wallet and requests a real approval/signature.

1. Start Home on the intended origin and open `/?account=signin`.
2. Confirm email is available when CDP is configured and **Continue with Base Account** is available when `HOME_SESSION_SECRET` is configured.
3. Select the intended Base Account on Base mainnet (`8453`). While the attempt is pending, confirm the sheet stays open with the phase message inside the Base Account button and no second overlay. Close the sheet to cancel, confirm Home remains signed out, and confirm focus returns to the page.
4. Retry and confirm the supported path shows one wallet approval. Inspect the SIWE prompt: address, chain, domain, URI, nonce, statement, issue time, and expiry must match the account and current Home origin.
5. In browser provider diagnostics, confirm the supported request order is `wallet_switchEthereumChain`, `wallet_connect`, `eth_chainId`, with no `eth_requestAccounts` or `personal_sign`.
6. If testing an explicitly unsupported wallet, confirm only a documented unsupported code enters the legacy signing phase and that `personal_sign` occurs once. Missing proof or any other error must fail rather than fall back.
7. Confirm `/api/session` returns `accountProvider: "base-account"` and the selected address using the `home-session` cookie, with no Authorization header.
8. Confirm subsequent private API requests carry `X-Home-Account-Provider: base-account` and scope data to that verified address.
9. Reload `/` and confirm the server redirects to `/dashboard`. Open `/?account=signin` and confirm it still renders the sign-in sheet.
10. Change account or chain during a second attempt and confirm the flow fails closed.
11. Sign out and confirm private details disappear, all four Home cookies are cleared, and reloading remains signed out.

## History

Before issue #408, Home connected with `eth_requestAccounts`, fetched an address-bound SIWE message, and requested a second `personal_sign` approval. The version-1 challenge cookie bound that address and a message hash. Both were replaced by the address-independent challenge and ERC-7846 one-approval path.

Before #392, a configured CDP project selected a separate CDP SIWE hop while clones without a project used Home-native SIWE. That split implementation and the retired `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT` flag are historical only; Base Account now always uses the Home-native route described above.

## References

- CDP email authentication: https://docs.cdp.coinbase.com/embedded-wallets/authentication/email
- Base Account provider methods: https://docs.base.org/base-account/reference/core/provider-rpc-methods
- Base Account signature verification guide: https://docs.base.org/base-account/guides/verify-signatures
- viem ERC-7846 connect action: https://viem.sh/experimental/erc7846/connect
