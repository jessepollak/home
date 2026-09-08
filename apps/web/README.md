# Home web

Next.js App Router, strict TypeScript, and Tailwind CSS. Run commands from the repository root:

```sh
bun install --frozen-lockfile
bun dev
bun test
bun check
```

## Current status

The local read-only build includes:

- Mobile-first welcome and responsive desktop shell.
- Presentation-only country selection for the United States, Brazil, Indonesia, and a neutral global fallback.
- Anonymous explicit country choices remembered in browser storage after hydration.
- Separate, English-only language display; selecting a country does not imply translation or eligibility.
- Home and Invest navigation, with Save reachable from the Home teaser.
- Typed region configuration plus pure resolver tests for supported, unknown, missing, and override cases.
- Root-scoped CDP email authentication, backend session validation, and verified account address display.
- Informational Stocks/Memes browsing, public Morpho USDC vault snapshots, and a server-only CDP SQL history adapter.

Current holdings/prices, Base Account sign-in, transaction signing, database persistence, and server geo are not implemented. No money actions are enabled. Browsing requires no credentials; email authentication uses the public project ID and matching server keys. See the root README's provider setup links for configuration and verified-versus-pending integration status.

- `app/`: routes, client presentation experience, root layout, and visual tokens.
- `config/regions.ts`: typed country/currency presentation registry and pure resolver.
- `config/country-preference.ts`: versioned anonymous browser preference helpers.
- `config/navigation.ts`: bounded primary navigation configuration.
- `.env.local`: local values, ignored by Git.

The CDP provider lives in `app/layout.tsx`; Home consumes the shared verified session. Country selection is presentation only, never an eligibility or authorization check. `bun check` runs deterministic tests, lint, typecheck, and the production build; live probes remain opt-in.

See the [root README](../../README.md), [product scope](../../docs/product-scope.md), and [implementation plan](../../docs/implementation-plan.md) for the broader build sequence. This slice is not full chunk 1: server geo, authenticated preference persistence, database readiness, and deployment checks remain for later work.
