# Nightly money-action simulation

The money-action simulation (`bun run --cwd apps/web sim:money`) runs once a night on the latest `main`. It is not a pull-request gate and uses no GitHub Actions minutes: a launchd agent on the operator's Mac runs it.

## What a run does

`scripts/money-sim/nightly.sh` performs these steps:

1. **Update the worktree.** It fetches `origin/main` and detaches a dedicated worktree at it (`~/src/home-worktrees/money-sim-nightly` by default). It creates the worktree when missing, then runs `bun run worktree:bootstrap -- --copy-env`.
2. **Run the simulation.** It runs `sim:money -- --runs 1000`. The simulation starts its own anvil fork and scratch PostgreSQL and never reads `DATABASE_URL`.
3. **Replay failures.** It replays every failing seed alone once with `--seed`.
   - A seed that passes alone is a **flake**.
   - A seed whose replay stops before any invariant result (fork startup, crash) is a **replay error**, reported apart from failures.
   - A seed whose replay violates an invariant again is **real**. If it is in the known #2292 cash-out swap set and violates nothing but the swap, it is a known swap instead. While #2292 is open, known swaps stay local.
4. **Write the one-line report.** It appends one line to `~/Library/Logs/home-money-sim/report.log`: the `main` SHA, the RESULT line, and the flakes, known swaps and real failures. Per-run output is kept in `runs/` beside it.
5. **Comment on real failures.** For a real failure outside the known set, it writes one comment per issue, naming the SHA, the RESULT line and each seed with its replay command.
   - A real failure with the #2292 swap signature goes to #2292.
   - Any other real failure, and any replay error, goes to the open money-actions debt issue, `chore(money-actions): pay down money-actions debt` ([work sizing](work-sizing.md)), counted only when Jesse or the factory bot opened it. With none open, it goes to #2292 under a "Non-swap failure" heading. No new issue is ever created.
   - The comment posts only as the factory bot account. The token is read at post time from the factory's own `~/.config/home-factory/bot-token` (owner-only), is used only for those `gh` calls, and must belong to `jessepollakj`. Without it, the comment stays in the local log.

6. **Alert when the run cannot finish.** If the worktree cannot be updated or bootstrapped, if the simulation ends without a RESULT line, or if runs fail but no failing seeds are listed, it logs locally and posts one "did not complete" alert. That alert goes to the debt issue, or to #2292 with none open, at most once per kind per week.

The agent runs at 02:00. When the Mac sleeps through 02:00, launchd runs the job once on wake. With `--scheduled`, each night slot runs once, and the report line notes nights the Mac missed entirely. A lock directory prevents overlapping runs. Manual runs never mark a night as done.

## Requirements

- **Bun:** on `PATH`.
- **Foundry `anvil`:** on `PATH`.
- **PostgreSQL server binaries:** `initdb` and `pg_ctl`, on `PATH`.
- **An archive-capable Base RPC:** `BASE_RPC_URL` in the primary checkout's `apps/web/.env.local`, which the bootstrap copies into the worktree.

## Turn it on

```sh
scripts/money-sim/install-launchd.sh
```

It copies `nightly.sh` to `~/.local/share/home-money-sim/`, installs `~/Library/LaunchAgents/ai.j.home-money-sim.plist`, and loads it. Rerun it after changing `nightly.sh` or the plist.

To run once now, outside the night window:

```sh
bash ~/.local/share/home-money-sim/nightly.sh --runs 20 --no-post
```

## Turn it off

```sh
scripts/money-sim/install-launchd.sh --uninstall
```

To pause without removing it, run `launchctl bootout gui/$(id -u)/ai.j.home-money-sim`. Run `install-launchd.sh` again to resume.
