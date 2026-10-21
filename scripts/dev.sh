#!/usr/bin/env bash
# Runs Cinder from source without packaging, for day-to-day development.
#   scripts/dev.sh          prepare (first time), compile and launch
#   scripts/dev.sh --quick  skip prepare/npm ci, just recompile and launch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != "--quick" ]; then
	[ -d "$ROOT/vscode/.git" ] || "$ROOT/scripts/get-vscode.sh"
	"$ROOT/scripts/prepare.sh"
	(cd "$ROOT/vscode" && npm ci)
else
	"$ROOT/scripts/build-extensions.sh"
	for ext in cinder-agent cinder-themes; do
		rm -rf "$ROOT/vscode/extensions/$ext"
		cp -R "$ROOT/.build/extensions/$ext" "$ROOT/vscode/extensions/$ext"
	done
fi

cd "$ROOT/vscode"
npm run compile
./scripts/code.sh
