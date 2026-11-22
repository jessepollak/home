# Nightly money-action simulation

The money-action simulation (`bun run --cwd apps/web sim:money`) runs once a night on the latest `main`. It is not a pull-request gate and uses no GitHub Actions minutes: a launchd agent on the operator's Mac runs it.

## What a run does

`scripts/money-sim/nightly.sh` performs these steps:

1. **Update the worktree.** It fetches `origin/main` and detaches a dedicated worktree at it (`~/src/home-worktrees/money-sim-nightly` by default). It creates the worktree when missing, then runs `bun run worktree:bootstrap -- --copy-env`.
2. **Run the simulation.** It runs `sim:money -- --runs 1000 --failing-seeds <file>`. The simulation starts its own anvil fork and scratch PostgreSQL and never reads `DATABASE_URL`.
3. **Check the result.** The night is green only when the simulation exits 0, its RESULT line reads every run as held, and the failing-seed list is empty. A green night appends one line to `~/Library/Logs/home-money-sim/report.log` and posts nothing.
4. **Replay failures.** It replays every failing seed alone once with `--seed`. A seed **failed again** only when its replay completed and reported an invariant violation. A seed that passes alone is a **flake**; a replay that stops before any invariant result is a **replay harness error**.
5. **Report the failure.** Any other outcome is a failure and posts one new comment on #2292 (`MONEY_SIM_ISSUE` overrides it):
   - seeds that violated an invariant, with each replay's outcome
   - a bootstrap failure, a missing RESULT line, or a nonzero exit, labelled as harness errors
   - a failing-seed list that is missing, unreadable, or whose count disagrees with RESULT

   The comment lists at most 20 seeds, counts the rest, and gives the replay command. The full list and per-run output stay in `runs/` beside the report log. There is no deduplication: each failing scheduled night posts its own comment.
6. **Post only as the bot.** Before posting, it asks GitHub who `~/.config/home-factory/bot-token` belongs to, using that token. Unless the answer is `jessepollakj`, it posts nothing, logs why, and exits nonzero. `--no-post` runs the same check and writes the comment to `runs/` instead.

The agent runs at 02:00. When the Mac sleeps through 02:00, launchd runs the job once on wake. With `--scheduled`, each night slot runs once, and the report line and comment note nights the Mac missed entirely. A kernel lock (`lockf`) prevents overlapping runs and is released automatically when a run exits or is killed. Manual runs never mark a night as done.

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
