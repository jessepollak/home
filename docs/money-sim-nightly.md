# Nightly money-action simulation

The money-action simulation (`bun run --cwd apps/web sim:money`) runs once a night on the latest `main`. It is not a pull-request gate and uses no GitHub Actions minutes. The runner, its schedule and its install, stop and log instructions live in the factory repository (`jessepollak/home-factory`, `ops/office.md`, "Nightly money simulation"), not here.

## What a night reports

- **Every run held:** nothing is posted.
- **An invariant violation:** one new comment on #2292 from the factory bot account. A violation counts when a batch run violated an invariant or a failing seed failed again when replayed alone. The comment lists at most 20 failing seeds and gives the replay command.
- **A harness error:** nothing is posted. Harness errors are an unreachable network, a failed worktree bootstrap, unreadable output, or a night whose failed runs all crashed before any invariant result. A night that could not bootstrap is retried later the same day.

## Reproduce a seed

```sh
bun run --cwd apps/web sim:money -- --seed <seed>
```

The simulation starts its own anvil fork and scratch PostgreSQL and never reads `DATABASE_URL`. It needs `bun`, Foundry `anvil`, PostgreSQL's `initdb` and `pg_ctl`, and an archive-capable `BASE_RPC_URL` in `apps/web/.env.local`.
