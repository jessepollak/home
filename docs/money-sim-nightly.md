# Nightly money-action simulation

The money-action simulation (`bun run --cwd apps/web sim:money`) runs once a night on the latest `main`. It is not a pull-request gate and uses no GitHub Actions minutes: a launchd agent on the operator's Mac runs it.

## What a run does

`scripts/money-sim/nightly.sh` performs these steps:

1. **Update the worktree.** It fetches `origin/main` and detaches a dedicated worktree at it (`~/src/home-worktrees/money-sim-nightly` by default). It creates the worktree when missing, then runs `bun run worktree:bootstrap -- --copy-env`.
2. **Run the simulation.** It runs `sim:money -- --runs 1000`. The simulation starts its own anvil fork and scratch PostgreSQL and never reads `DATABASE_URL`.
3. **Replay failures.** It replays every failing seed alone once with `--seed`.
   - A seed that passes alone is a **flake**, logged locally only.
   - A seed whose replay stops before any invariant result (fork startup, crash) is a **replay error**, reported apart from failures.
   - A seed whose completed replay violates an invariant again is a **failure**. A failure on a seed in the known #2292 set that violates nothing but the swap is a **known swap**.
4. **Write the one-line report.** It appends one line to `~/Library/Logs/home-money-sim/report.log`: the `main` SHA, the RESULT line, and the flakes, known swaps, failures and replay errors. Per-run output is kept in `runs/` beside it.
5. **Report through standing comments.** Every reported kind is one comment from the factory bot account. The first night a kind appears, the comment is posted and notifies; later nights edit it in place with the latest SHA, RESULT and seeds, so nothing repeats nightly.
   - **Known swap and new swap seeds:** #2292.
   - **Other failures and replay errors:** the open `chore(money-actions): pay down money-actions debt` issue ([work sizing](work-sizing.md)), counted only when Jesse or the factory bot opened it. With none open, they go to #2292 under their own heading. No issue is ever created.
   - **The token:** read at post time from the factory's own `~/.config/home-factory/bot-token` (owner-only), and used only for the calls that post or edit. Without it, the comment stays in the local log.
6. **Alert when the run cannot finish.** Each failed invocation gets its own standing "did not complete" alert, on the same debt issue or #2292: the worktree could not be updated or bootstrapped (`setup`), the simulation ended without a RESULT line (`no-result`), or runs failed but no failing seeds were listed (`seed-list`).

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
