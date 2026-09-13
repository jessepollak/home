# Home

**The WordPress for neobanks.**

Open-source software for building a global money app on Base. Customize the brand, regional presentation, assets, and provider integrations for your community, customers, or country.

> **Development status:** Home is under active development. It is not production-authorized or a real-money deployment.

## Product

Real browser captures of the current app with sample data. Select an image for full size.

<table>
  <tr>
    <td align="center">
      <a href="docs/readme/home.png"><img src="docs/readme/home.png" width="250" alt="Sample-data capture of the Home mobile dashboard with balance, send, save, and activity actions"></a><br>
      <strong>Home</strong>
    </td>
    <td align="center">
      <a href="docs/readme/save.png"><img src="docs/readme/save.png" width="250" alt="Sample-data capture of the current Save screen with USDC vault choices"></a><br>
      <strong>Save</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="docs/readme/invest.png"><img src="docs/readme/invest.png" width="250" alt="Sample-data capture of the Invest screen with stock and crypto discovery shelves"></a><br>
      <strong>Invest</strong>
    </td>
    <td align="center">
      <a href="docs/readme/send.png"><img src="docs/readme/send.png" width="250" alt="Sample-data capture of the Send money amount sheet"></a><br>
      <strong>Send</strong>
    </td>
  </tr>
</table>

Capture provenance and regeneration instructions are in [`docs/readme/`](docs/readme/README.md).

## Get started

### Prerequisites

- [Bun](https://bun.sh/) **1.3.12**, pinned by `packageManager`.
- Node.js **22.13 or newer**.

### Install and run

```sh
git clone https://github.com/jessepollak/home.git
cd home
bun install --frozen-lockfile

if [ ! -e apps/web/.env.local ]; then
  cp .env.example apps/web/.env.local
fi

bun dev
```

Open `http://localhost:3000`. Public surfaces work without credentials. Email sign-in and authenticated wallet features require your own CDP project and allowed local origin; see [CDP setup](docs/cdp-setup.md). Keep secrets server-side and out of Git.

Actions require PostgreSQL through `DATABASE_URL`. The current action contract is [Home is thin](docs/home-is-thin.md): Home keeps one confirmed action record; the server authors calldata; the client dispatches through CDP or Base; provider and chain data determine status.

### Useful commands

```sh
bun test       # deterministic unit and contract tests
bun lint       # ESLint
bun typecheck  # generated route types and strict TypeScript
bun build      # production build
bun check      # test, lint, typecheck, and build
```

## Customize it

| Customize | Start here |
| --- | --- |
| Brand, colors, and navigation | `apps/web/config/brand.ts`, `apps/web/app/globals.css`, `apps/web/config/navigation.ts` |
| Countries and currency presentation | `apps/web/config/regions.ts` |
| Wallet, savings, and Invest assets | `apps/web/config/portfolio-assets.ts`, `apps/web/shared/savings/config.ts`, `apps/web/config/invest-assets.ts` |
| Account, data, funding, and protocol providers | `apps/web/server/` and the matching setup guides in `docs/` |

Read [Fork and extend](docs/fork-and-extend.md) before publishing a customized deployment. Country selection changes presentation and formatting; it does not grant eligibility.

## Repository map

| Place | Purpose |
| --- | --- |
| `apps/web/app/` | Next.js routes, metadata, and global styles |
| `apps/web/client/` | Product experiences, client state, and flows |
| `apps/web/shared/` | Contracts, validation, math, formatting, and presenters |
| `apps/web/server/` | Authenticated provider, protocol, persistence, and action boundaries |
| `apps/web/config/` | Brand, region, navigation, asset, and presentation configuration |
| `docs/` | Setup, product, architecture, and extension guides |

## Contributing

Focused upstream changes are welcome. Read [CONTRIBUTING](CONTRIBUTING.md), keep credentials and funded-wallet secrets out of Git, and run `bun check` before opening a pull request.

## License

Original repository content is licensed under [MIT](LICENSE). Third-party materials, provider SDKs, fonts, and trademarks keep their own terms.

The Home mark's font provenance and reuse constraints are documented in [`apps/web/public/home-mark/PROVENANCE.md`](apps/web/public/home-mark/PROVENANCE.md). Do not assume the Home mark, its fonts, or Base-related marks are covered by the MIT license.
