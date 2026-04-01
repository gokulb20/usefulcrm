---
name: Daemonless environment support
overview: Add daemonless mode support across all CLI commands via a `DENCHCLAW_DAEMONLESS=1` environment variable (plus per-command `--skip-daemon-install` flags), and document it in the README.
todos:
  - id: helper
    content: Create isDaemonlessMode() helper that checks opts.skipDaemonInstall || DENCHCLAW_DAEMONLESS env var
    status: pending
  - id: bootstrap
    content: "Update bootstrap-external.ts: env var fallback, skip post-onboard gateway restart entirely, skip attemptGatewayAutoFix entirely, skip gateway health probe"
    status: pending
  - id: web-runtime-cmd
    content: "Update web-runtime-command.ts: add skipDaemonInstall to option types, skip restartGatewayDaemon entirely in daemonless mode, skip LaunchAgent in update/start/restart/stop"
    status: pending
  - id: register-flags
    content: Add --skip-daemon-install flag to register.update.ts, register.start.ts, register.restart.ts, register.stop.ts
    status: pending
  - id: readme
    content: Add Daemonless / Docker section to README.md
    status: pending
  - id: tests
    content: Update existing tests if needed to cover daemonless codepaths
    status: pending
isProject: false
---

# Daemonless Environment Support

## Problem

`--skip-daemon-install` currently only affects bootstrap's `hermes onboard` call. Three other codepaths still attempt daemon/service registration and will fail or waste time in container environments:

1. `**restartGatewayDaemon()**` in `update`/`start`/`restart` runs `hermes gateway install --force` (registers a system service)
2. `**installWebRuntimeLaunchAgent()**` on macOS writes a launchd plist and calls `launchctl load`
3. `**attemptGatewayAutoFix()**` in bootstrap runs `gateway install --force` as a repair step

## Approach

### Env var + CLI flag

- `**DENCHCLAW_DAEMONLESS=1**` env var — set once in Dockerfile, all commands respect it
- `**--skip-daemon-install**` CLI flag — per-command override, already exists on `bootstrap`
- Resolution: `opts.skipDaemonInstall || process.env.DENCHCLAW_DAEMONLESS === '1'`

A shared helper `isDaemonlessMode(opts?: { skipDaemonInstall?: boolean })` in a small utility avoids repeating this logic.

### What changes per command

`**bootstrap**` ([src/cli/bootstrap-external.ts](src/cli/bootstrap-external.ts)):

- Onboard `--install-daemon` and `--skip-health` already gated (current diff)
- **Skip** post-onboard `gateway restart` entirely (line 2421-2432) — no service to restart
- **Skip** `attemptGatewayAutoFix()` entirely (line 2450-2467) — stop/install/start all operate on a registered service
- **Skip** the gateway health probe loop (line 2440-2444) — no daemon to probe
- Read `DENCHCLAW_DAEMONLESS` env var as fallback for `opts.skipDaemonInstall`

`**update`** ([src/cli/web-runtime-command.ts](src/cli/web-runtime-command.ts) `updateWebRuntimeCommand`):

- **Skip** `restartGatewayDaemon()` entirely — `stop`/`install`/`start` all operate on a registered service that doesn't exist
- Skip `installWebRuntimeLaunchAgent` as `startFn` — let `ensureManagedWebRuntime` use its default `startManagedWebRuntime` (spawns child process, works everywhere)
- Skip `uninstallWebRuntimeLaunchAgent` call

`**start`/`restart`** ([src/cli/web-runtime-command.ts](src/cli/web-runtime-command.ts) `startWebRuntimeCommand`):

- Same as update: skip `restartGatewayDaemon` entirely, skip LaunchAgent, use `startManagedWebRuntime`

`**stop`** ([src/cli/web-runtime-command.ts](src/cli/web-runtime-command.ts) `stopWebRuntimeCommand`):

- Skip `uninstallWebRuntimeLaunchAgent` (avoids noisy `launchctl` errors in containers)

### Gateway behavior in daemonless mode

Per [Hermes docs](https://docs.hermes.ai/start/getting-started), the gateway supports a foreground mode:

```
hermes gateway --port 18789
```

This runs the gateway as a regular process (no service manager needed). In daemonless mode:

- **Skip ALL gateway daemon management** — `gateway install`, `gateway start`, `gateway stop`, `gateway restart` all operate on a registered launchd/systemd service
- The gateway must be started separately by the user as a foreground process (e.g., in Docker `CMD` or a process supervisor like `supervisord`)
- UsefulCRM commands only manage the **web runtime** (spawned as a child process via `startManagedWebRuntime`)

### Files to modify

- [src/cli/bootstrap-external.ts](src/cli/bootstrap-external.ts) — env var fallback, gate auto-fix install step, gate post-onboard restart
- [src/cli/web-runtime-command.ts](src/cli/web-runtime-command.ts) — add `skipDaemonInstall` to option types, thread through `restartGatewayDaemon`, `updateWebRuntimeCommand`, `startWebRuntimeCommand`, `stopWebRuntimeCommand`; skip LaunchAgent when daemonless
- [src/cli/program/register.update.ts](src/cli/program/register.update.ts) — add `--skip-daemon-install` flag
- [src/cli/program/register.start.ts](src/cli/program/register.start.ts) — add `--skip-daemon-install` flag
- [src/cli/program/register.restart.ts](src/cli/program/register.restart.ts) — add `--skip-daemon-install` flag
- [src/cli/program/register.stop.ts](src/cli/program/register.stop.ts) — add `--skip-daemon-install` flag
- [README.md](README.md) — add "Daemonless / Docker" section documenting the env var and flag

### README addition (under Commands section)

```markdown
### Daemonless / Docker

For containers or environments without systemd/launchd, set:

```bash
export DENCHCLAW_DAEMONLESS=1
```

This skips all gateway daemon management (install/start/stop/restart) and launchd LaunchAgent installation across all commands. You must start the gateway yourself as a foreground process:

```bash
hermes --profile useful gateway --port 19001
```

Alternatively, pass `--skip-daemon-install` to individual commands:

```bash
npx usefulcrm --skip-daemon-install
npx usefulcrm update --skip-daemon-install
```

```

```

