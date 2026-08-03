# Claude Cowork Vision Acceptance — 2026-08-03

## Scope

Replace Claude's single `macos-automator` MCP target with this maintained
Mac Automator Vision build. Preserve upstream AppleScript/JXA tools, add
read-only GrokBuild inspection, and do not connect Claude to
`GrokBuildComputerUseMCP`.

## Source and runtime

- Upstream base: `steipete/macos-automator-mcp` commit
  `44a376f0b6e150a3bfd4093369163aa5c5abeb71` (upstream version 0.4.6).
- Local package: `@schmitzjimmy1-star/macos-automator-vision-mcp` 0.1.0.
- Node: `/Users/jimmyschmitz/.nvm/versions/node/v24.14.0/bin/node`.
- Vision engine:
  `/Applications/GrokBuild.app/Contents/MacOS/agent-desktop`.
- Claude config:
  `/Users/jimmyschmitz/Library/Application Support/Claude/claude_desktop_config.json`.
- Rollback config:
  `/Users/jimmyschmitz/Library/Application Support/Claude/claude_desktop_config.pre-macos-automator-vision-20260803.json`.

## Automated verification

- `pnpm run typecheck`: passed.
- `pnpm run format:check`: passed.
- `pnpm run lint`: passed.
- `pnpm test`: 3 files, 15 tests, 0 failures.
- `pnpm run build`: passed.
- `pnpm run smoke:vision`: passed against the installed signed
  `agent-desktop` and a running GrokBuild window.

The live smoke proved the exact six-tool surface, a permission receipt, a
GrokBuild accessibility snapshot, native `image/png` output, a combined fresh
verification, and rejection of `Messages` as a non-allowlisted application.
It also caught and repaired two real isolation edges. The signed helper can
appear as another process named GrokBuild, so capture now requires the
`com.grokbuild.app` bundle ID/PID and resolves it to a concrete visible
main-window ID before targeting that window without a redundant ambiguous app
filter. Claude can host parallel MCP client contexts, so every server process
also appends its PID to the configured session prefix rather than sharing refs.

## Claude/Cowork acceptance

After a full Claude quit/relaunch, Claude's own logs recorded
`Connected to macos-automator (6 tools)` and announced all six tools to Cowork.
One bounded Opus acceptance prompt required `vision_permissions`, `inspect_app`,
and `capture_app`, forbade `execute_script` and all UI actions, and asked for a
visible GrokBuild detail.

Claude reported:

- Accessibility granted.
- Screen Recording granted.
- Automation unknown and not prompted.
- Visible main-window title: `GrokBuild`.
- A dark chat layout with the bottom `Ask, build, or review… / for skills`
  composer and its toolbar controls.
- No `execute_script` call and no action performed.
- Final marker: `CLAUDE-GROKBUILD-VISION-OK-0803`.

After the bundle-ID/PID and per-process session hardening, Claude was fully
quit and relaunched again. Its fresh processes reconnected and announced six
tools. Claude then called only `verify_app`, reported GrokBuild window `w-319`,
confirmed a 3016x1774 PNG of that same main window, reported no
`execute_script` call or action, and settled with
`CLAUDE-GROKBUILD-HARDENED-OK-0803`.

No `agent-desktop` process remained after the tool calls settled. GrokBuild was
left running and Claude was left on the final completed acceptance
conversation.
