# Home web

Next.js App Router, strict TypeScript, and Tailwind CSS. Run commands from the repository root:

```sh
bun install --frozen-lockfile
bun dev
bun test
bun check
```

For the app contract, read [Architecture](../../docs/architecture.md), [Actions](../../docs/actions.md), and [Balances](../../docs/balances.md). See [CONTRIBUTING](../../CONTRIBUTING.md) for the full engineering contract.

This workspace contains routes and thin adapters in `app/`, client experiences in `client/`, framework-free contracts in `shared/`, authenticated and provider boundaries in `server/`, reusable UI in `components/`, and typed product configuration in `config/`. ESLint enforces the split: shared code cannot depend on app/client/server/component or framework code; client and component code cannot import server code; server code cannot import app, client, or component code. Every non-test server module begins with `import "server-only";`, and API handlers and clients use versioned contracts from `shared/`.

Copy the root `.env.example` to ignored `.env.local` without overwriting it. Public screens work without credentials; authenticated features need your own configured providers. Actions also require `DATABASE_URL`; `bun run db:up` starts local PostgreSQL. See [Fork and extend](../../docs/fork-and-extend.md) for operator configuration.

Home is locally runnable, not a production authorization. `bun check` and the mocked browser smoke cover local regressions; they do not imply live provider, funded-wallet, deployment, or end-to-end settlement acceptance.
