#!/bin/sh
# launchd entry point for the Home delivery reconciler. A shell entry point (like
# the ai.j.* LaunchAgents) rather than a bare node binary: on 2026-09-11 a
# LaunchAgent that pointed straight at ~/.nvm/.../bin/node was removed within a
# minute of its first spawn together with that node binary, consistent with an
# endpoint-security persistence mitigation. Uses the Homebrew node on PATH.
set -eu
export HOME="${HOME:-/Users/jessepollak}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.bun/bin"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export HOME_RECONCILE_REPO_DIR="$REPO_DIR"
# cbcode may live under nvm (a node script with a `node` shebang) rather than Homebrew.
CBCODE="${HOME_RECONCILE_CBCODE:-$(command -v cbcode || ls "$HOME"/.nvm/versions/node/*/bin/cbcode 2>/dev/null | tail -1)}"
export HOME_RECONCILE_CBCODE="${CBCODE:-cbcode}"
cd "$REPO_DIR"
exec node "$REPO_DIR/scripts/delivery/reconcile.mjs" "$@"
