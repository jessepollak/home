#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$repository/node_modules/.bin/agent-browser"
if [ ! -x "$binary" ]; then
  echo 'Pinned agent-browser is missing. Run bun install --frozen-lockfile in the Home worktree.' >&2
  exit 1
fi
expected=$(cd "$repository" && bun -p 'require("./package.json").devDependencies["agent-browser"]')
actual=$("$binary" --version) || {
  echo 'Pinned agent-browser failed its version check. Run bun install --frozen-lockfile.' >&2
  exit 1
}
if [ "$actual" != "agent-browser $expected" ]; then
  echo "Expected agent-browser $expected, found $actual. Run bun install --frozen-lockfile." >&2
  exit 1
fi
exec "$binary" "$@"
