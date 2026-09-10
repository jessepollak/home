# CDP session validation setup

Status: local implementation completed September 7, 2026; real browser login and deployed-origin verification remain pending.

Home validates CDP end-user access tokens at `GET /api/session`. The browser sends its CDP access token in the `Authorization` header, and the server returns only the verified CDP subject and Base smart-account address. This endpoint validates identity only; it does not assert that the account is deployed, funded, eligible, or able to transact.

Missing, malformed, invalid, expired, or cross-project tokens return `401 UNAUTHENTICATED`. Missing server credentials and provider initialization, transport, rate-limit, or service failures return `503 AUTH_UNAVAILABLE`. Every response is private and `no-store`; provider payloads and errors are not returned. A provider `401` can also indicate mismatched or invalid developer credentials, so the required private live smoke must verify both browser sign-in and server validation with credentials from the same CDP project.

## Local setup

1. Create or select a CDP project and configure `http://localhost:3000` as an allowed local origin in its public project settings.
2. For a fresh clone, copy the root `.env.example` to `apps/web/.env.local` and set `NEXT_PUBLIC_CDP_PROJECT_ID` to the project's public ID. If that file already exists, add only missing variables; do not overwrite existing credentials.
3. Set the server-only `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` values from that same project. Never give either variable a `NEXT_PUBLIC_` prefix.
4. Run `bun dev`, then open `http://localhost:3000/account`.
5. Complete email sign-in in the browser. Keep the real one-time code and access token in the browser flow; do not paste either into a shell command or shell history.

The server SDK's usage tracking and error reporting are disabled by Home before the SDK loads when `DISABLE_CDP_USAGE_TRACKING` and `DISABLE_CDP_ERROR_REPORTING` are unset. Operators may explicitly set either variable to `false` to opt that channel back in after reviewing CDP's data policy. This default applies in production even when `.env.example` was not copied.

## Preview auth

Email OTP and Base Account are only testable on `http://localhost:3000` and the production alias (`https://home-web-jessepollaks-projects.vercel.app`) right now. Those origins stay on Embedded Wallet CORS. Vercel preview hosts are not allowlisted — sign-in fails there (`We could not send a code…`, `We could not connect to Base Account…`). Those banners are CDP client rejections after the app loaded, not Vercel Deployment Protection. Background: [#67](https://github.com/jessepollak/home/issues/67). Hosting notes: [Vercel deploy](vercel-deploy.md#preview-auth).

**Default (A).** Smoke auth on localhost or production. PR previews stay UI/layout.

**Escape hatch (B).** Add a preview origin only when a PR must demo sign-in on its own preview. Do not add every preview. No bot — paste the branch-stable origin into Portal yourself.

### Embedded Wallet CORS vs Onramp

[CDP Domain Allowlisting](https://docs.cdp.coinbase.com/wallets/security-and-policies/domain-allowlisting) for Embedded Wallets requires exact origins (scheme + host + port). No wildcards. Maximum **50** domains. Portal-only — there is no public manage API.

Onramp’s domain list is a **separate** Portal surface and does support `https://*.domain.com`. That list does **not** fix email OTP, Embedded Wallet CORS, or SIWE. Add an Onramp origin only when testing Fund / buy on that host.

### Branch-stable origin

Prefer Vercel’s [Git branch URL](https://vercel.com/docs/deployments/generated-urls) (survives redeploys) over a one-off deployment-hash host:

```
https://<project>-git-<sanitized-branch>-<scope>.vercel.app
```

This repository’s current Vercel project, as used for production smoke:

| Piece | Value |
|---|---|
| Project | `home-web` |
| Scope | `jessepollaks-projects` |
| Production | `https://home-web-jessepollaks-projects.vercel.app` |
| Branch alias | `https://home-web-git-<sanitized-branch>-jessepollaks-projects.vercel.app` |

Sanitize the branch: lowercase; each run of characters outside `[a-z0-9]` becomes one `-`. Example: `cursor/headless-fund-onramp-caa5` → `cursor-headless-fund-onramp-caa5`.

If the label before `.vercel.app` would exceed 63 characters, Vercel truncates it (and may also shorten for anti-phishing). Then copy the **branch** origin from the address bar or the Vercel “Visit Preview” link — still not the hash host.

### Portal click-path

1. [CDP Portal](https://portal.cdp.coinbase.com) → the project for `NEXT_PUBLIC_CDP_PROJECT_ID` (same project; do not rotate keys to work around CORS).
2. Embedded Wallets → **CORS / Allowed domains** → Add domain. Paste the exact origin: no path, no trailing slash.
3. If `NEXT_PUBLIC_ENABLE_BASE_ACCOUNT=1`, also allow that origin for **SIWE / Clients** in the same project. See [Base Account](base-account.md).
4. Hard-refresh the preview. Retry email, then Base Account if the flag is on.

### 50-domain cap

Prune origins for merged or closed PRs. Do not leave every preview on the list. Production and `http://localhost:3000` stay.

### Smoke checklist

- [ ] Default: email OTP (and Base Account if enabled) on localhost or production. Auth is not testable on an unlisted preview.
- [ ] Escape hatch only if this PR must demo auth on its preview: add the branch-stable origin, then confirm the address bar matches the Portal entry.
- [ ] After Portal save: email code sends; Base Account connects when the flag is on.
- [ ] After the PR closes: remove that preview origin.
- [ ] Do not treat Onramp wildcards or a green preview build as Embedded Wallet CORS.

Do not record real OTPs, access tokens, or server credentials.

## Required live smoke

With private credentials configured, verify that browser email sign-in succeeds, `GET /api/session` returns the expected project identity, private account details remain hidden on validation failure, and sign-out completes. Run that smoke on the policy A host. Repeat on a preview only after adding that origin (policy B). Do not record real OTPs, access tokens, or server credentials in commands, screenshots, logs, or documentation.

## Milestone boundary

This milestone establishes server-side token validation only. The returned `subject` is the verified CDP identity, not a persisted Home user ID. There is no database persistence or wallet-link record in this implementation. Deterministic selection among multiple accounts and broader rate-limiting policy remain deferred before production; do not infer either from a successful validation response.
