# dsh-perm-guard 🛡️

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**Auto-approval permission guard** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web — the "middle tier" between `workspace-write` (asks too often) and `danger-full-access` (too open). Common operations like cross-directory edits, `git commit`/`merge` and builds run **without approval prompts**; destructive operations (deletes, disk ops, privilege escalation, `curl|sh`) **always ask for human confirmation**.

*Unofficial project: independently developed and maintained by a community member, not an official DeepSeek product.*

## Screenshot

![Auto button in the composer tool row](assets/screenshot-auto-button.png)

![Auto Permissions settings page](assets/screenshot-settings.png)

## Features

- **Two modes** (switchable in the settings page, persisted):
  - **Standard** — auto-approve inside the trust directories (workspace, sibling directories, custom list); outside + risky operations prompt.
  - **Aggressive** — location-unrestricted: only destructive operations still prompt.
- **11 per-category tri-state switches** (auto / ask / deny) with your personal defaults.
- **Audit trail** — every decision is recorded (approved / forwarded to human / rejected) with timestamp and command summary.
- **Persistent config** — `~/.dsh/perm-guard.json`, survives restarts. Zero host dependencies.

## Install

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-perm-guard#main"
```

Then restart `dsh web`. Update: `dsh plugin --profile web update dsh-perm-guard`, restart.

Manual install fallback: see [docs/install.md](docs/install.md).

## Usage

- **Auto button** — in the composer tool row (left of the input box). Click to toggle auto-approval on/off (green = on). Off restores the host's default approval behavior completely.
- **Settings → "Auto 权限" (Auto Permissions)** — total switch, mode selection (Standard / Aggressive), 11 category switches, trust directory editor, and the recent-decision audit list.
- **Rules apply to all sessions** (including subagents) while enabled.

### Mode defaults

| Category | Standard | Aggressive |
|---|---|---|
| File edit (write/edit/cp/mv/mkdir) | auto (in trust dirs) | auto |
| Git local (commit/merge/rebase/checkout) | auto | auto |
| Build / test / install | auto | auto |
| Read-only queries (ls/cat/grep/git status) | auto | auto |
| **Delete (rm, reset --hard, clean -fd)** | **ask** | **ask** |
| **Protected paths (.ssh/.aws/secrets/.env/system dirs)** | **ask** | **ask** |
| **Privilege (sudo, services, global installs)** | ask | ask |
| **Network download-execute (curl\|sh)** | ask | ask |
| Git push | ask | auto |
| Publish / deploy | ask | auto |
| **Disk / partition / device** | **ask** | **ask** |

Switching modes resets the category switches to that mode's defaults (adjustable afterwards).

### Never auto-approved (all modes)

- Deletion: `rm`, `rm -rf /` or `~` (circuit breaker, even with `$(...)` variants), `git reset --hard`, `git clean -fd`, `Remove-Item`
- Disk: `dd` writing devices, `mkfs`/`fdisk`/`wipefs`/`diskutil` erase, writes to `/dev/`
- Privilege: `sudo`/`su`, service management (`launchctl`/`systemctl`), recursive `chmod`/`chown` on `/` or `~`
- Network download-execute: `curl|sh`, `wget|sh`
- Force push: `git push --force` / `-f` (rewrites history)
- Writes to protected paths

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ development environment |
| Linux | ⚠️ expected to work |
| Windows | ⚠️ expected to work |

## Requirements

- DSH web (the approval system this plugin guards)
- `pnpm` in PATH — `dsh plugin` is a pnpm forwarder (needed for install/update)

## How it works

- **Interception before the host prompt** — every approval request is intercepted before the host prompt; the actual command/target is classified, and safe operations are auto-answered `allowed-once` (~13ms, no popup), risky ones are forwarded to the human prompt.
- **Command-level firewall** (`tools/pre-execute`) — dangerous categories are intercepted *before* the sandbox even rejects them.
- **Classification pipeline** — the two modes set per-category defaults (Standard: trust directories; Aggressive: location-unrestricted), and the 11 tri-state switches (auto / ask / deny) fine-tune each category.
- **Audit + persistence** — every decision is recorded with timestamp and command summary; approval decisions are always persisted via the host's `approval/asked` + `approval/decided` event pair.

## Notes

- DSH's sandbox has **no OS-level network fence** (unlike Codex): the plugin can only detect download-execute patterns (`curl|sh`) in command text, not block other network traffic.
- Terminal sessions, subagent creation, model calls and MCP tools are outside the approval system entirely.
- Commands whose *text* contains danger words (e.g. echoing `"Remove-Item"`, or scripts embedding rule sources) are conservatively intercepted — expected, rare in practice.
- The audit list is in-memory (60 entries) and resets on restart; approval decisions themselves are always persisted via the host's `approval/asked` + `approval/decided` event pair.

## Coverage

- **All approval entry points in DSH are covered**: `bash`, `pwsh` (PowerShell), and the `write`/`edit` file tools. MCP tools and other read-only tools have no approval mechanism and are unaffected.
- **Compound commands** (`a && rm -rf x`): pure-word chains are split and evaluated per subcommand, taking the strictest result; chains containing variables/redirection/wildcards are treated conservatively as one unit.
- **Unknown commands** always fall back to "ask" regardless of mode (safe default) — the classifier never auto-allows what it cannot parse.

## How it compares to Claude Code / Codex

| | Claude Code | Codex | dsh-perm-guard |
|---|---|---|---|
| Read-only command set | built-in, not configurable | sandbox | built-in + configurable |
| `rm -rf / ~` breaker | always prompts | sandbox blocks | always prompts (all modes) |
| Protected paths | yes | `.git`/`.agents`/`.codex` | `.ssh`/`.aws`/secrets/system dirs/`.git` |
| Network isolation | tool-level | OS-level (default off) | **not available** (DSH has no OS network fence; only `curl\|sh` pattern detection) |
| Approval categories | 3 tool classes | 5 granular switches | 11 explicit switches + 2 modes |
| Auditing | prompts only | logs | in-plugin audit + host `approval/asked`/`decided` events |

## Configuration file

`~/.dsh/perm-guard.json` (created on first change):

```json
{
  "enabled": true,
  "mode": "standard",
  "categories": { "fileEdit": "auto", "...": "..." },
  "trustedDirs": []
}
```

- `trustedDirs`: extra absolute paths auto-approved in Standard mode (default: workspace + its sibling directories).
- Trust directories are ignored in Aggressive mode (location-unrestricted).

## Development

```sh
# hot-plug testing (no restart)
# 1. define a dynamic Cordis plugin with the same decision logic
# 2. cordis_run → verify → cordis_stop

# static bundle (this repo layout)
# symlink to ~/.dsh/profiles/web/node_modules/dsh-perm-guard
# add "dsh-perm-guard" to ~/.dsh/profiles/web/package.json dsh.profile.bundles
# restart dsh web
```

Verification matrix: [docs/verify-checklist.md](docs/verify-checklist.md)

## License

[MIT](LICENSE)
