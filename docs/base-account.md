# Base Account sign-in

Status: deployable, operator-gated authentication path added September 7, 2026; real Base Account signature compatibility has not yet been proven by a user smoke test.

Home can show **Continue with email** and **Continue with Base Account** together in the existing sign-in sheet. Both methods authenticate through CDP and converge on the existing server-validated Home session. Base Account mode is enabled only when `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT=1`; email sign-in remains unchanged when the flag is absent.

## Security boundary

The Base Account path does not create a Home nonce or verifier. It:

1. connects through `@base-org/account` `2.5.10`, configured for Base mainnet (`8453`), manual subaccount creation, and the universal account as the default;
2. requests a CDP SIWE challenge with the connected address, chain `8453`, current host, and current origin;
3. UTF-8 hex-encodes and signs the exact `message` returned by CDP using `personal_sign`;
4. sends only CDP's unchanged `flowId` and the provider's unchanged hex signature to `verifySiweSignature`;
5. validates the resulting CDP access token on the server; and
6. selects the address only from the validated CDP profile's `authenticationMethods` entry with `type: "siwe"`.

The browser's connected address is never accepted by the server as session authority. It is retained only in memory long enough for the client to require the server-returned SIWE address to match. Home does not persist that raw connector address. Base mode also refuses missing, malformed, or multiple distinct SIWE addresses instead of falling back to a CDP embedded account.

Account or chain changes during connection, signing, or verification invalidate the connector and hide the session. Logout and CDP owner changes clear both the selected connector and visible private session details. The SDK is not used to create a Base subaccount, request transactions, export keys or tokens, grant spend permissions, or approve calldata.

## Important compatibility limitation

CDP's installed SIWE API describes the submitted signature as an ERC-191 hex signature and says verification is hosted/on-chain, but the available CDP documentation does not explicitly confirm ERC-1271 or ERC-6492 support for Base Account smart-wallet signatures on chain `8453`. The implementation therefore fails closed if `verifySiweSignature` rejects the signature and tells the user that the account remains signed out. Do not claim successful Base Account compatibility until the real smoke below passes with the intended funded account.

CDP's validated SIWE authentication profile contains an address but no chain ID. The signed challenge binds chain `8453`, and the connector checks Base before and after signing, but Home cannot recover authoritative chain provenance from the later profile alone. The returned `accountProvider: "base-account"` value records which verified profile field Home selected; it is presentation/connector provenance, not new authorization, account linking, funding proof, deployment proof, or transaction readiness.

An initial Base sign-in may create a separate CDP user from an existing email login. This flow does not silently merge identities. Linking an email-authenticated CDP user to a Base Account would require a separate explicit user-authorized linking feature.

## Operator setup

1. Complete an independent security review of the connector, SIWE verification, and server account-selection diff before enabling the flag for a real wallet test or deployment.
2. In the same CDP project used by Home, configure the exact local or deployed web origin as an allowed origin and enable SIWE authentication if the project's authentication settings require explicit method enablement. Hosted smoke uses the forever-allowlisted staging/prod host by default; add a Vercel preview origin only when that PR must demo Base Account there. Same origin must appear on Embedded Wallet CORS **and** SIWE / Clients — Onramp wildcards do not count. See [CDP preview auth](cdp-setup.md#preview-auth) and [#67](https://github.com/jessepollak/home/issues/67).
3. Keep the existing `NEXT_PUBLIC_CDP_PROJECT_ID`, `CDP_API_KEY_ID`, and `CDP_API_KEY_SECRET` configuration from `docs/cdp-setup.md`.
4. Set `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT=1` in the deployment environment. For a local test, add it to the existing gitignored `apps/web/.env.local`; do not overwrite that file or record its values.
5. Leave the flag unset to deploy email-only sign-in. The server rejects requests that select Base Account mode when the matching flag is off.

## Exact manual user smoke

No automated agent should perform this smoke because it opens a real wallet and requests a real signature.

1. Start Home normally and open `/account` or the existing account sheet on the configured origin.
2. Confirm both **Continue with email** and **Continue with Base Account** are present. Confirm email login still follows the existing OTP flow.
3. Select **Continue with Base Account** and choose the user's existing funded main Base Account. Do not create or choose a new subaccount.
4. Confirm the wallet is on Base mainnet (`8453`). Cancel once and verify Home remains signed out with private details hidden.
5. Retry. Review the SIWE prompt before signing: the address must be the selected account, the chain must be `8453`, and the domain/URI must match the current Home origin. The nonce and expiry must be CDP-generated. Do not copy the message, signature, OTP, access token, or credentials into logs or shell history.
6. Complete `personal_sign`. If CDP rejects the smart-wallet signature, record only the sanitized Home error and stop: ERC-1271/ERC-6492 compatibility remains unverified and no fallback is permitted.
7. If verification succeeds, inspect the same-origin `/api/session` response in browser developer tools. It must contain `accountProvider: "base-account"` and the selected funded address, not an address from `evmSmartAccountObjects`. The UI must show that same address only after the response succeeds.
8. Inspect the subsequent same-origin `/api/portfolio` request. It must carry `X-Home-Account-Provider: base-account`, and its response wallet must be the same server-verified SIWE address. Confirm Home labels the dominant amount as USD/USDC, shows ETH separately as a token amount, and does not claim a combined net worth or local-currency conversion.
9. During a second run, change the wallet account or chain while signing/verifying. Home must block the flow, clear the connector, and keep private details hidden.
10. Sign out and confirm the address and balances disappear immediately. Repeat after a reload and after switching CDP users to ensure no stale Base address or prior wallet amount is displayed.
11. Repeat the smoke on the forever-allowlisted staging/prod host before enabling the flag for users. Repeat on a preview only after that origin is on CORS and SIWE / Clients. A successful authentication or balance-read smoke does not authorize transactions or spending delegation.

## References

- CDP SIWE authentication: https://docs.cdp.coinbase.com/embedded-wallets/authentication/siwe
- Base Account `personal_sign`: https://docs.base.org/base-account/reference/core/provider-rpc-methods/personal_sign
- Base Account `wallet_connect`: https://docs.base.org/base-account/reference/core/provider-rpc-methods/wallet_connect
- Base Account signature verification guide: https://docs.base.org/base-account/guides/verify-signatures
