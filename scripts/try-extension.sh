#!/usr/bin/env bash
# Fastest feedback loop: runs Cinder's extensions inside the VS Code you
# already have installed, without building the fork. Good for working on the
# chat, sessions and themes. The workbench patches (fonts, default theme) only
# show up in the real Cinder build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# VS Code to run: $CODE if set (may have arguments, e.g. "flatpak run
# com.visualstudio.code"), else `code` on PATH, else the Flatpak.
if [ -n "${CODE:-}" ]; then
	read -r -a CODE_CMD <<<"$CODE"
elif command -v code >/dev/null 2>&1; then
	CODE_CMD=(code)
elif command -v flatpak >/dev/null 2>&1 && flatpak info com.visualstudio.code >/dev/null 2>&1; then
	CODE_CMD=(flatpak run com.visualstudio.code)
else
	echo "VS Code not found. Install it, or set CODE to the command that starts it." >&2
	exit 1
fi

(cd "$ROOT/extensions/cinder-agent" && [ -d node_modules ] || npm ci --no-audit --no-fund)
(cd "$ROOT/extensions/cinder-agent" && npm run build)

"${CODE_CMD[@]}" \
	--new-window \
	--extensionDevelopmentPath="$ROOT/extensions/cinder-agent" \
	--extensionDevelopmentPath="$ROOT/extensions/cinder-themes" \
	"$@"
