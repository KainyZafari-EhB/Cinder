#!/usr/bin/env bash
# Fastest feedback loop: runs Cinder's extensions inside the VS Code you
# already have installed, without building the fork. Good for working on the
# chat, sessions and themes. The workbench patches (fonts, default theme) only
# show up in the real Cinder build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE="${CODE:-code}"

(cd "$ROOT/extensions/cinder-agent" && [ -d node_modules ] || npm ci --no-audit --no-fund)
(cd "$ROOT/extensions/cinder-agent" && npm run build)

"$CODE" \
	--new-window \
	--extensionDevelopmentPath="$ROOT/extensions/cinder-agent" \
	--extensionDevelopmentPath="$ROOT/extensions/cinder-themes" \
	"$@"
