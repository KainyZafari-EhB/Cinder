# Cinder

Cinder is Kainy's conversation-first IDE: a VS Code fork where conversations with Claude come first and each one opens its project. Read README.md for the feature list and commands.

## How the fork works

Cinder is not a GitHub fork of microsoft/vscode. It is a patch repo, like VSCodium:

1. `scripts/get-vscode.sh` clones the VS Code tag in `upstream.json` into `./vscode` (gitignored).
2. `scripts/prepare.sh` merges `product.json`, applies `patches/*.patch`, copies `fonts/` and `branding/`, builds the two extensions and copies them into `vscode/extensions/` as built-in extensions.
3. `scripts/dev.sh` compiles and runs from source; `scripts/build.sh` packages the app.

Rules that keep this maintainable:

- Put features in `extensions/cinder-agent`, not in patches. Patch VS Code only for things an extension cannot do (default theme, workbench CSS, fonts).
- Never edit files under `./vscode` by hand; they are wiped by `get-vscode.sh`. To change VS Code, edit the checkout, then regenerate the patch with `git -C vscode diff -- <files> > patches/NNNN-name.patch` (use `git add -N` for new files first).
- Updating VS Code: change the tag in `upstream.json`, run `get-vscode.sh` and `prepare.sh`, and fix any patch that no longer applies.
- Themes are generated: edit the palettes in `extensions/cinder-themes/generate.mjs`, then run `node generate.mjs`. Do not hand-edit `themes/*.json`.

## The agent extension (`extensions/cinder-agent`)

- `src/agent/conversation.ts`: one conversation = one long-lived Agent SDK `query()` in streaming-input mode (`PromptQueue`). Edits are auto-accepted (`permissionMode: 'acceptEdits'`) and tracked by PreToolUse/PostToolUse hooks for review; other tools ask through `canUseTool`, shown as permission cards.
- `src/agent/edits.ts`: snapshots files before Claude edits them, for diffs and Undo.
- `src/core/`: pure logic with unit tests (transcript building from SDK messages, line diff counts, session listing, env isolation). Keep it free of `vscode` imports.
- `src/controller.ts`: home screen, chat view, switching projects. Opening a conversation from another project stores a handoff in global state, then opens that folder; the new window picks it up in `startup()`.
- `webview/`: the UI (plain TypeScript + DOM, no framework). Colors come from theme CSS variables, so every theme works. Messages between host and webview are typed in `src/protocol.ts`.
- Conversations are Claude Code sessions in `~/.claude/projects`, listed with the SDK's `listSessions()`.

Constraints:

- Authentication is an Anthropic API key only (secret storage or `ANTHROPIC_API_KEY`). Anthropic does not allow third-party apps built on the Agent SDK to offer claude.ai login, so do not add it.
- Branding: the product is Cinder. It must not be called or look like Claude Code; "Claude Agent" or "Powered by Claude" are fine. The app icon and mark are original (`branding/`, `media/mark.svg`).
- `src/core/agentEnv.ts` strips inherited `CLAUDE*`/`ANTHROPIC_*` variables before starting Claude Code. Keep that, or a Cinder launched from inside a Claude Code session would reuse that session's credentials.

## Checks

From `extensions/cinder-agent`: `npm run typecheck`, `npm test`, `npm run test:smoke` (real Claude Code process; uses `ANTHROPIC_API_KEY` if set, otherwise checks that a bad key is reported). For UI changes, run `scripts/try-extension.sh` or `scripts/dev.sh` and look at the result.

## Status and next steps

Done: home screen, conversation list across projects, open conversation → project window, streaming chat in the secondary side bar, permission prompts, Stop, edit review with Keep/Undo, three themes, fonts, app icon (Linux and Windows).

Not verified yet: the full VS Code build was not run when this was set up (the build machine could not download Electron). First job on a real machine: `scripts/dev.sh`, then fix whatever the build reports.

Open to-dos:
- macOS app icon (`resources/darwin/code.icns` is still upstream's).
- Review all of a turn's edits at once ("Keep all" / "Undo all").
- Attach files or selections from the editor to a message.
- Model picker in the conversation view (today: the `cinder.model` setting).
- Show subagent progress inside the parent tool row.
