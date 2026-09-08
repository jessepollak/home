# Home web

Next.js App Router, strict TypeScript, and Tailwind CSS. This file is a workspace command note, not a feature inventory — see the [root Get started](../../README.md#get-started) path, [build status](../../docs/build-status.md), [wallet runtime](../../docs/wallet-runtime-spike.md), [architecture review](../../docs/architecture-review-2026-09.md), and [fork and extend](../../docs/fork-and-extend.md).

Run commands from the repository root:

```sh
bun install --frozen-lockfile
bun dev
bun test
bun check
```

## Workspace layout

Delivery state lives in [build status](../../docs/build-status.md), not in this file. Browsing requires no credentials; email authentication uses the public project ID and matching server keys from your CDP project.

- `app/`: routes, client presentation experience, root layout, and visual tokens.
- `config/`: brand, regions, country preference, navigation, invest/portfolio asset identities.
- `features/`: account, Invest, Savings, money-action UI.
- `.env.local`: local values, ignored by Git. Copy from the repo-root `.env.example`; do not overwrite an existing file.

The CDP provider lives in `app/layout.tsx`; Home consumes the shared verified session. Country selection is presentation only, never an eligibility or authorization check. `bun check` runs deterministic tests, lint, typecheck, and the production build; live probes remain opt-in.

See [fork and extend](../../docs/fork-and-extend.md) to change brand, regions, assets, or providers. Production shared persistence and deployment remain later work; local money actions use SQLite under `.local/`.
