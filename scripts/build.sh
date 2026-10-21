#!/usr/bin/env bash
# Full build: downloads VS Code, turns it into Cinder and packages the app
# for this machine. The result lands next to the repo, e.g. ../VSCode-linux-x64.
# First run takes a while (VS Code itself is compiled from source).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$(uname -s)" in
	Linux) PLATFORM=linux ;;
	Darwin) PLATFORM=darwin ;;
	MINGW* | MSYS* | CYGWIN*) PLATFORM=win32 ;;
	*) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	x86_64 | amd64) ARCH=x64 ;;
	arm64 | aarch64) ARCH=arm64 ;;
	*) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

"$ROOT/scripts/get-vscode.sh"
"$ROOT/scripts/prepare.sh"

cd "$ROOT/vscode"
npm ci
npm run gulp "vscode-$PLATFORM-$ARCH-min"

echo "Cinder built: $(cd "$ROOT/.." && pwd)/VSCode-$PLATFORM-$ARCH"
