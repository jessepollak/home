#!/usr/bin/env bash
# Installs (or with --uninstall removes) the nightly money-action simulation launchd agent for the current user.
# See docs/money-sim-nightly.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
label="ai.j.home-money-sim"
agent="$HOME/Library/LaunchAgents/$label.plist"
share="$HOME/.local/share/home-money-sim"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$agent" "$share/nightly.sh"
  echo "removed $label"
  exit 0
fi
command -v anvil >/dev/null || { echo "anvil (Foundry) is not on PATH" >&2; exit 1; }
command -v initdb >/dev/null && command -v pg_ctl >/dev/null || { echo "initdb and pg_ctl are not on PATH" >&2; exit 1; }
mkdir -p "$share" "$HOME/Library/Logs/home-money-sim" "$(dirname "$agent")"
install -m 755 "$here/nightly.sh" "$share/nightly.sh"
sed "s#__HOME__#$HOME#g" "$here/$label.plist" > "$agent"
plutil -lint "$agent" >/dev/null
launchctl bootstrap "$domain" "$agent"
echo "installed $label: hourly check, runs once a night between 01:00 and 06:00"
