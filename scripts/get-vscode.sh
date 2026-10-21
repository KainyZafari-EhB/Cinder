#!/usr/bin/env bash
# Downloads the pinned VS Code source (see upstream.json) into ./vscode.
# Re-running it resets ./vscode to a clean checkout of that tag.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(node -p "require('$ROOT/upstream.json').repo")"
TAG="$(node -p "require('$ROOT/upstream.json').tag")"
DEST="$ROOT/vscode"

if [ -d "$DEST/.git" ] && [ "$(git -C "$DEST" describe --tags --exact-match 2>/dev/null || true)" = "$TAG" ]; then
	echo "Resetting existing VS Code $TAG checkout"
	git -C "$DEST" reset --hard --quiet
	git -C "$DEST" clean -fdq -e node_modules -e .build -e out
else
	rm -rf "$DEST"
	echo "Cloning VS Code $TAG"
	git clone --depth 1 --branch "$TAG" "$REPO" "$DEST"
fi

echo "VS Code $TAG is in ./vscode"
