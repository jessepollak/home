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
# launchd runs without shell startup files, so the agent's PATH is built from where each tool resolves now.
agent_path=""
for tool in bun anvil initdb pg_ctl git gh; do
  found=$(command -v "$tool") || { echo "$tool is not on PATH" >&2; exit 1; }
  dir=$(dirname "$found")
  case ":$agent_path:" in *":$dir:"*) ;; *) agent_path="${agent_path:+$agent_path:}$dir" ;; esac
done
agent_path="$agent_path:/usr/bin:/bin:/usr/sbin:/sbin"
for tool in bun anvil initdb pg_ctl git gh; do
  env -i PATH="$agent_path" /bin/bash -c "command -v $tool" >/dev/null || { echo "$tool does not resolve on the agent PATH" >&2; exit 1; }
done
mkdir -p "$share" "$HOME/Library/Logs/home-money-sim" "$(dirname "$agent")"
install -m 755 "$here/nightly.sh" "$share/nightly.sh"
sed -e "s#__HOME__#$HOME#g" -e "s#__PATH__#$agent_path#g" "$here/$label.plist" > "$agent"
plutil -lint "$agent" >/dev/null
launchctl bootstrap "$domain" "$agent"
echo "installed $label: runs each night once, from 02:00 or the first hourly firing after it while the Mac is fully awake"
