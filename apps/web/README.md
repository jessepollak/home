# Home web

Next.js App Router, strict TypeScript, and Tailwind CSS. Run commands from the repository root:

```sh
bun install --frozen-lockfile
bun dev
bun test
bun check
```

For the app contract, read [Home is thin](../../docs/home-is-thin.md); for current boundaries, read the [architecture review](../../docs/architecture-review-2026-09.md). This workspace contains routes and presentation in `app/`, client experiences in `client/`, shared contracts in `shared/`, authenticated boundaries in `server/`, and typed product configuration in `config/`.

Copy the root `.env.example` to ignored `.env.local` without overwriting it. Public screens work without credentials; authenticated features need your own configured providers. See [Fork and extend](../../docs/fork-and-extend.md) for operator configuration.
