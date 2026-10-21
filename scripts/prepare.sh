#!/usr/bin/env bash
# Turns the clean VS Code checkout in ./vscode into Cinder:
#   1. merges product.json (name, IDs, Open VSX marketplace)
#   2. applies every patch in ./patches
#   3. builds Cinder's own extensions and copies them in as built-in extensions
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE="$ROOT/vscode"

if [ ! -d "$VSCODE/.git" ]; then
	echo "No ./vscode checkout found. Run scripts/get-vscode.sh first." >&2
	exit 1
fi

echo "==> Merging product.json"
node "$ROOT/scripts/merge-product.mjs" "$ROOT/product.json" "$VSCODE/product.json"

echo "==> Applying patches"
for patch in "$ROOT"/patches/*.patch; do
	[ -e "$patch" ] || continue
	if git -C "$VSCODE" apply --reverse --check "$patch" 2>/dev/null; then
		echo "    already applied: $(basename "$patch")"
	else
		git -C "$VSCODE" apply --whitespace=nowarn "$patch"
		echo "    applied: $(basename "$patch")"
	fi
done

echo "==> Copying fonts and icons"
cp "$ROOT"/fonts/*.ttf "$VSCODE/src/vs/workbench/browser/media/"
cp "$ROOT/branding/icon-512.png" "$VSCODE/resources/linux/code.png"
cp "$ROOT/branding/icon-512.png" "$VSCODE/resources/server/code-512.png"
cp "$ROOT/branding/cinder.ico" "$VSCODE/resources/win32/code.ico"
# macOS still uses upstream's code.icns; see CLAUDE.md for the open to-do.

echo "==> Building Cinder extensions"
"$ROOT/scripts/build-extensions.sh"

for ext in cinder-agent cinder-themes; do
	rm -rf "$VSCODE/extensions/$ext"
	cp -R "$ROOT/.build/extensions/$ext" "$VSCODE/extensions/$ext"
	echo "    installed built-in extension: $ext"
done

echo "Done. ./vscode is now Cinder."
