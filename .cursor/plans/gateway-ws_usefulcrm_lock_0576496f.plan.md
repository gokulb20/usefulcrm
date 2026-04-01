---
name: gateway-ws usefulcrm lock
overview: Migrate `apps/web` chat transport from CLI `--stream-json` processes to Gateway WebSocket while preserving the existing SSE API contract, then lock web to a single `usefulcrm` profile and disable workspace/profile switching (403 for disabled APIs). Add targeted web and bootstrap tests for the new behavior.
todos:
  - id: ws-transport-adapter
    content: Implement Gateway WebSocket-backed AgentProcessHandle adapter in apps/web/lib/agent-runner.ts while keeping existing NDJSON event contract.
    status: completed
  - id: active-runs-ws-rpc
    content: Swap abort and subagent follow-up CLI gateway calls to WebSocket RPC calls in active-runs/subagent-runs.
    status: completed
  - id: profile-default-lock
    content: Default web runtime profile resolution to usefulcrm in workspace.ts and ensure state/web-chat/workspace paths resolve under ~/.hermes-usefulcrm.
    status: completed
  - id: api-lockdown
    content: Return 403 for profile/workspace mutation APIs and keep /api/profiles compatible with a single usefulcrm profile payload.
    status: completed
  - id: ui-single-profile
    content: Remove profile switch/create workspace controls from sidebars and empty state; clean workspace page wiring accordingly.
    status: completed
  - id: useful-path-update
    content: Update skills/useful/SKILL.md workspace path references to ~/.hermes-usefulcrm/workspace.
    status: completed
  - id: web-tests
    content: Update/add apps/web tests covering WS transport behavior, API lock responses, and usefulcrm path resolution.
    status: completed
  - id: bootstrap-tests
    content: Add src/cli tests for run-main bootstrap cutover logic and bootstrap-external diagnostics behavior.
    status: completed
isProject: false
---

# Migrate Web Chat to Gateway WS + Lock UsefulCRM Profile

## Final behavior

- Keep frontend transport unchanged (`/api/chat` + `/api/chat/stream` SSE contract remains intact).
- Replace backend CLI stream/process transport with Gateway WebSocket transport.
- Force single-profile behavior in web runtime (`usefulcrm`), so workspace/chat/session paths resolve to `~/.hermes-usefulcrm/*`.
- Disable profile/workspace mutation endpoints with `403` (`/api/profiles/switch`, `/api/workspace/init`).
- Remove/disable UI controls for profile switching and workspace creation.

## Transport migration (backend only)

- Add a Gateway WS runtime client in `[apps/web/lib/agent-runner.ts](apps/web/lib/agent-runner.ts)` that:
  - opens a WS connection to Gateway,
  - performs `connect` handshake,
  - starts parent runs via Gateway RPC,
  - tails `agent` events and emits NDJSON lines compatible with existing `ActiveRun` parsing.
- Preserve `AgentProcessHandle` shape so `[apps/web/lib/active-runs.ts](apps/web/lib/active-runs.ts)` and `[apps/web/lib/subagent-runs.ts](apps/web/lib/subagent-runs.ts)` can keep their SSE event transformation logic unchanged.
- Replace CLI `gateway call` usage with WS RPC helper calls for abort/follow-up paths in:
  - `[apps/web/lib/active-runs.ts](apps/web/lib/active-runs.ts)`
  - `[apps/web/lib/subagent-runs.ts](apps/web/lib/subagent-runs.ts)`

## Profile/path locking

- Update profile resolution in `[apps/web/lib/workspace.ts](apps/web/lib/workspace.ts)` so web runtime defaults to `usefulcrm` (without changing test-mode assumptions), ensuring state dir resolves to `~/.hermes-usefulcrm` unless explicitly overridden.
- Keep filesystem resolvers (`resolveHermesStateDir`, `resolveWebChatDir`, `resolveWorkspaceRoot`) as the single source of truth used by chat/session/tree APIs.
- Update watcher ignore path in `[apps/web/next.config.ts](apps/web/next.config.ts)` to include usefulcrm state dir.

## Disable profile/workspace mutation surfaces

- Return `403` in:
  - `[apps/web/app/api/profiles/switch/route.ts](apps/web/app/api/profiles/switch/route.ts)`
  - `[apps/web/app/api/workspace/init/route.ts](apps/web/app/api/workspace/init/route.ts)`
- Make `[apps/web/app/api/profiles/route.ts](apps/web/app/api/profiles/route.ts)` return a single effective `usefulcrm` profile payload for UI compatibility.

## UI updates (single-profile UX)

- Remove profile/workspace creation controls from:
  - `[apps/web/app/components/workspace/workspace-sidebar.tsx](apps/web/app/components/workspace/workspace-sidebar.tsx)`
  - `[apps/web/app/components/sidebar.tsx](apps/web/app/components/sidebar.tsx)`
  - `[apps/web/app/components/workspace/empty-state.tsx](apps/web/app/components/workspace/empty-state.tsx)`
- Update workspace page wiring in `[apps/web/app/workspace/page.tsx](apps/web/app/workspace/page.tsx)` to drop `onProfileSwitch` / `onWorkspaceCreated` refresh flow no longer reachable in single-profile mode.
- Keep chat/subagent naming semantics intact (`agent:main:web:<sessionId>` and existing subagent keys).

## Useful skill path update

- Replace `~/.hermes/workspace` references with `~/.hermes-usefulcrm/workspace` in `[skills/useful/SKILL.md](skills/useful/SKILL.md)`.

## Tests to add/update

- Transport and runtime tests:
  - update/add in `[apps/web/lib/agent-runner.test.ts](apps/web/lib/agent-runner.test.ts)` for WS handshake/start/subscribe/abort behavior and session-key naming.
  - update in `[apps/web/lib/active-runs.test.ts](apps/web/lib/active-runs.test.ts)` where transport assumptions changed.
- API lock tests:
  - update `[apps/web/app/api/profiles/route.test.ts](apps/web/app/api/profiles/route.test.ts)` for single-profile payload and `403` switch behavior.
  - update `[apps/web/app/api/workspace/init/route.test.ts](apps/web/app/api/workspace/init/route.test.ts)` for `403` lock behavior.
- Path behavior tests:
  - add/adjust targeted assertions in workspace resolver tests for usefulcrm state/web-chat/workspace directories.
- Bootstrap tests (new):
  - add `src/cli` tests for rollout/cutover behavior in `[src/cli/run-main.ts](src/cli/run-main.ts)`.
  - add diagnostics/rollout gate tests for `[src/cli/bootstrap-external.ts](src/cli/bootstrap-external.ts)` exported helpers.

## Runtime data flow (post-migration)

```mermaid
flowchart LR
chatPanel[ChatPanel useChat] --> apiChat[/api/chat]
apiChat --> activeRuns[active-runs startRun]
activeRuns --> gatewayProc[agent-runner WS process-handle adapter]
gatewayProc --> gatewayWs[Gateway WebSocket]
gatewayWs --> gatewayProc
gatewayProc --> activeRuns
activeRuns --> sse[/api/chat/stream SSE]
sse --> chatPanel
```

## Verification after implementation

- Run web tests for changed areas (`agent-runner`, `active-runs`, chat API, profiles/workspace-init API).
- Run bootstrap-focused tests for `src/cli/run-main.ts` and `src/cli/bootstrap-external.ts`.
- Smoke-check workspace tree and web sessions resolve under `~/.hermes-usefulcrm` with switching/creation controls disabled.
