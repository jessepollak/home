# Nightly money-action simulation

The money-action simulation (`bun run --cwd apps/web sim:money`) runs once a night on the latest `main`. It is not a pull-request gate and uses no GitHub Actions minutes: a launchd agent on the always-on studio Mac runs it. It does not run on a laptop: a sleeping laptop fires the job in a dark wake and loses the network mid-run.

## What a run does

`scripts/money-sim/nightly.sh` performs these steps:

1. **Wait for the network.** Every run holds the Mac awake with `caffeinate -i -s` until it exits. A run that fires on wake can start before the network is up, so it first retries `git ls-remote origin` with backoff for up to 10 minutes. If GitHub never answers, the run is a harness error.
2. **Update the worktree.** It fetches `origin/main` and detaches a dedicated worktree at it (`~/src/home-worktrees/money-sim-nightly` by default). It retries each fetch with backoff for about two minutes, creates the worktree when missing, then runs `bun run worktree:bootstrap -- --copy-env`, retrying it with backoff for about five minutes. A scheduled night counts as done only once this step succeeds.
3. **Run the simulation.** It runs `sim:money -- --runs 1000 --failing-seeds <file>`. The simulation starts its own anvil fork and scratch PostgreSQL and never reads `DATABASE_URL`.
4. **Check the result.** The night is green only when the simulation exits 0, its RESULT line reads every run as held, and the failing-seed list is empty. A green night appends one line to `~/Library/Logs/home-money-sim/report.log` and posts nothing.
5. **Replay failures.** The seed list tags each failed batch run as an invariant violation or a crash (a harness error with no invariant result). It replays every failing seed alone once with `--seed`. A seed **failed again** only when its replay completed and reported an invariant violation; otherwise its replay either passed alone or stopped before any invariant result (a harness error).
6. **Report the failure.** When at least one batch run violated an invariant or a replay failed again, the night posts one new comment on #2292 (`MONEY_SIM_ISSUE` overrides it), each failed run labelled as a violation or a crash, with its replay's outcome.

   The comment lists at most 20 seeds, counts the rest, and gives the replay command. The full list and per-run output stay in `runs/` beside the report log. There is no deduplication: each failing scheduled night posts its own comment.

   A harness error posts nothing: it appends one `harness error:` line to `report.log` and exits nonzero. Harness errors are a night whose failed runs all crashed with no replay failing again, an unreachable network, a failed worktree update or bootstrap, a missing or unreadable RESULT line, a nonzero exit with every run held, and a failing-seed list that is missing, malformed, or whose count disagrees with RESULT.
7. **Post only as the bot.** Before posting, it asks GitHub who `~/.config/home-factory/bot-token` belongs to, using that token. Unless the answer is `jessepollakj`, it posts nothing, logs why, and exits nonzero. The identity check and the comment each retry with backoff (about two and five minutes) when GitHub does not answer; a comment that still fails is logged locally, and the night stays done. `--no-post` runs the same check and writes the comment to `runs/` instead.

The agent fires at 02:00 and every hour (`StartInterval` 3600); launchd also fires a slot missed during sleep once on wake. With `--scheduled`, the night slot is the most recent 02:00, and it runs once: the first firing after 02:00 that finds the Mac fully awake runs it, and later firings do nothing. A network or bootstrap error leaves the night to the next hourly firing. The report line and comment note nights the Mac missed entirely. A kernel lock (`lockf`) prevents overlapping runs and is released automatically when a run exits or is killed. Manual runs never mark a night as done.

## Requirements

- **The studio Mac:** always on, with sleep disabled, and a primary checkout at `~/src/home` (`MONEY_SIM_REPO` overrides it). The script creates its own worktree from it.
- **Bun:** on `PATH`.
- **Foundry `anvil`:** on `PATH` (`brew install foundry`).
- **PostgreSQL server binaries:** `initdb` and `pg_ctl`, on `PATH`.
- **An archive-capable Base RPC:** `BASE_RPC_URL` in the primary checkout's `apps/web/.env.local`, which the bootstrap copies into the worktree.
- **The factory bot token:** `~/.config/home-factory/bot-token`, mode 600, for failure comments.

## Turn it on

On the studio Mac, from a login shell so `bun`, `anvil` and the PostgreSQL binaries resolve:

```sh
zsh -lc ~/src/home/scripts/money-sim/install-launchd.sh
```

It copies `nightly.sh` to `~/.local/share/home-money-sim/`, installs `~/Library/LaunchAgents/ai.j.home-money-sim.plist`, and loads it. The agent gets the install shell's `PATH`, plus `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` when set, so `bun install` trusts a TLS-inspecting network's CA bundle. Rerun it after changing `nightly.sh` or the plist. Check it with `launchctl list | grep home-money-sim`.

To run once now, outside the night window:

```sh
bash ~/.local/share/home-money-sim/nightly.sh --runs 20 --no-post
```

## Turn it off

```sh
scripts/money-sim/install-launchd.sh --uninstall
```

To pause without removing it, run `launchctl bootout gui/$(id -u)/ai.j.home-money-sim`. Run `install-launchd.sh` again to resume.
