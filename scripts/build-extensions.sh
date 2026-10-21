#!/usr/bin/env bash
# Builds Cinder's extensions into .build/extensions/<name>, ready to ship:
# only the runtime files plus production dependencies.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.build/extensions"
rm -rf "$OUT"
mkdir -p "$OUT"

# Agent extension: compile, then stage with production dependencies only.
AGENT="$ROOT/extensions/cinder-agent"
(cd "$AGENT" && npm ci --no-audit --no-fund && npm run build)
mkdir -p "$OUT/cinder-agent"
cp -R "$AGENT/package.json" "$AGENT/package-lock.json" "$AGENT/dist" "$AGENT/media" "$OUT/cinder-agent/"
(cd "$OUT/cinder-agent" && npm ci --omit=dev --omit=peer --no-audit --no-fund --ignore-scripts)
rm "$OUT/cinder-agent/package-lock.json"
# npm installs both the glibc and musl builds of Claude Code on Linux; keep one.
if [ "$(uname -s)" = "Linux" ]; then
	if ldd --version 2>&1 | grep -qi musl; then
		find "$OUT/cinder-agent/node_modules/@anthropic-ai" -maxdepth 1 -name 'claude-agent-sdk-linux-*' ! -name '*-musl' -exec rm -rf {} +
	else
		find "$OUT/cinder-agent/node_modules/@anthropic-ai" -maxdepth 1 -name 'claude-agent-sdk-linux-*-musl' -exec rm -rf {} +
	fi
fi

# Themes extension: plain JSON, copied as-is.
cp -R "$ROOT/extensions/cinder-themes" "$OUT/cinder-themes"

echo "Extensions built in .build/extensions"
