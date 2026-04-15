# CLI Simplification — Handoff Context

**Date**: 2026-03-31
**Status**: In Progress
**Prior spec**: `specs/20260330T160000-simplify-cli-config-clients-only.md`

## What happened

We refactored the CLI package (`packages/cli/`) across 7 commits to eliminate ~550 lines of dead code, branching logic, and vestigial features. The core change: `epicenter.config.ts` now exports **pre-wired workspace clients** (results of `createWorkspace()`) instead of raw schema definitions. The CLI no longer decides how to wire persistence, sync, or auth—the config author does.

### Commits (in order)

1. `refactor(cli): accept only WorkspaceClient exports from epicenter.config.ts`
2. `fix(cli): update smoke-test to use new clients-only config API`
3. `refactor(cli): delete resolve-config.ts and loadClientFromPath`
4. `refactor(cli): move load-config.ts to src root, delete empty config/ folder`
5. `test(cli): add tab-manager e2e test using real app workspace factory`
6. `refactor(cli): delete dead code — vestigial auth logging, unused exports, redundant checks`
7. Several follow-up commits: named export enforcement, default export removal, workspace client moves

### What was removed

| Deleted | Why |
|---|---|
| `resolve-config.ts` (209 lines) | Every function had zero callers |
| `loadClientFromPath()` | Redundant variant of `loadConfig` |
| `isWorkspaceDefinition()` + `classifyAndAdd()` | Definition support dropped |
| `definitions[]` from `LoadConfigResult` | One return type: `clients[]` only |
| Definition wiring loop in `start-daemon.ts` | Daemon no longer auto-wires extensions |
| Definition branch in `open-workspace.ts` | Same |
| `toWebSocketUrl()`, `clearAllSessions()`, `resolveServer()`, `resolveToken()` | Zero callers |
| `cacheDir()` | Zero callers |
| `--server` flag on `start` command | Daemon no longer wires sync |
| Auth/server logging in daemon | Vestigial—daemon doesn't connect to servers |
| Default-vs-named export branching in `loadConfig` | `Object.entries(module)` handles both; we chose named-only |

## Current file structure

```
packages/cli/src/
├── auth/
│   ├── api.ts              (236 lines) Typed HTTP client for auth endpoints
│   ├── device-flow.ts       (77 lines) RFC 8628 device code flow
│   └── store.ts            (135 lines) Session storage, URL normalization
├── commands/
│   ├── auth-command.ts     (129 lines) auth login/logout/status
│   ├── data-command.ts     (300 lines) data tables/list/get/count/delete/kv
│   ├── start-command.ts     (36 lines) start [dir]
│   └── workspace-command.ts(434 lines) workspace add/install/uninstall/ls/export
├── runtime/
│   ├── open-workspace.ts   (103 lines) Load config → find client → return
│   └── start-daemon.ts      (71 lines) Load config → wait ready → stay alive
├── util/
│   ├── format-output.ts     (57 lines) JSON/JSONL output formatting
│   ├── parse-input.ts      (118 lines) JSON input from argv/file/stdin
│   ├── paths.ts             (11 lines) resolveEpicenterHome, workspacesDir
│   └── typebox-to-yargs.ts (121 lines) Convert TypeBox schemas → yargs options
├── bin.ts                   (19 lines) CLI entrypoint
├── cli.ts                   (31 lines) Yargs wiring
├── index.ts                  (6 lines) Public API exports
└── load-config.ts           (88 lines) Import config, collect workspace clients
```

## Current CLI commands

```
epicenter
├── start [dir]                 Load config → wait for clients → stay alive
├── auth
│   ├── login --server <url>    Device code flow (RFC 8628)
│   ├── logout [--server]       Clear stored session
│   └── status [--server]       Show current auth state
├── workspace
│   ├── add <path>              Symlink local workspace into ~/.epicenter/
│   ├── install <item>          Install from jsrepo registry
│   ├── uninstall <id>          Remove workspace
│   ├── ls                      List installed workspaces
│   └── export <id>             Dump table data as JSON
└── data
    ├── tables                  List table names
    ├── list <table>            List all valid rows
    ├── get <table> <id>        Get single row
    ├── count <table>           Count valid rows
    ├── delete <table> <id>     Delete a row
    └── kv
        ├── get <key>           Get KV value
        ├── set <key> [value]   Set KV value
        └── delete <key>        Reset to default
```

## How `epicenter.config.ts` works now

```typescript
// epicenter.config.ts — what users write
import { createTabManagerWorkspace } from '@epicenter/tab-manager/workspace';
import { filesystemPersistence } from '@epicenter/workspace/extensions/sync/desktop';

export const tabManager = createTabManagerWorkspace()
  .withExtension('persistence', filesystemPersistence({
    filePath: '.epicenter/persistence/epicenter.tab-manager.db'
  }));
```

The config exports named workspace clients. The CLI:
1. Dynamically imports the config file
2. Iterates `Object.entries(module)`, skips `default`, duck-types for `{ id, definitions, tables }`
3. Returns `{ configDir, clients[] }`

Each client is already wired with whatever extensions the config author chained. The CLI doesn't add anything—it's a passthrough.

## Key source files to read

These are the files you need for any CLI work:

- **`packages/cli/src/load-config.ts`** — The entire config loading system (88 lines). One function: `loadConfig(dir) → { configDir, clients[] }`.
- **`packages/cli/src/runtime/start-daemon.ts`** — The daemon (71 lines). Loads config, waits, stays alive.
- **`packages/cli/src/runtime/open-workspace.ts`** — Opens a single workspace for data commands (103 lines).
- **`packages/cli/src/commands/data-command.ts`** — All `data` subcommands (300 lines). Pattern: `runDataCommand(opts, fn, format)`.
- **`packages/cli/src/util/typebox-to-yargs.ts`** — Converts TypeBox schemas to yargs options (121 lines). Currently unused but needed for action introspection.
- **`packages/cli/test/fixtures/tab-manager/epicenter.config.ts`** — Example config using a real app factory.
- **`packages/cli/test/e2e-tab-manager.test.ts`** — E2e test proving config loading + CRUD + actions + persistence.

## Workspace action introspection

Every workspace client has an `.actions` property that's introspectable:

```typescript
client.actions.devices.list        // function with metadata
client.actions.devices.list.type   // 'query'
client.actions.devices.list.title  // 'List Devices'
client.actions.devices.list.input  // TypeBox schema: Type.Object({})

client.actions.devices.list({})    // callable → { devices: [...] }
```

Actions are defined via `defineQuery` or `defineAction` with TypeBox `input` schemas. The `typeboxToYargsOptions` utility (121 lines, well-tested) converts those schemas into yargs flag definitions. This is the bridge for auto-generating CLI commands from workspace actions.

## Next steps — candidate features

### 1. `epicenter run` — Action introspection (high value)

Auto-generate CLI subcommands from workspace actions:

```
epicenter run <workspace-id> <action.path> [--flags from TypeBox input]
epicenter run tab-manager devices.list
epicenter run honeycrisp notes.search --query "meeting notes"
```

Implementation approach:
- Load config → iterate `client.actions` recursively
- For each action: convert `action.input` via `typeboxToYargsOptions` → register yargs subcommand
- Call action, output result via `output()` helper

Key files: `load-config.ts`, `typebox-to-yargs.ts`, `data-command.ts` (pattern to follow)

### 2. `epicenter serve` — Local HTTP server (use with caution)

Auto-generate REST endpoints from workspace tables + actions:

```
GET  /tab-manager/devices/list      → calls action
POST /tab-manager/tables/devices    → table CRUD
GET  /tab-manager/kv/:key           → KV access
```

**Danger**: arbitrary write access, no auth by default, CRDT semantics are surprising over HTTP, sync extensions propagate writes immediately. If built: bind `127.0.0.1` only, require explicit opt-in for writes.

### 3. Scripting story (already works)

```typescript
// scripts/seed.ts — just import the config
import { tabManager } from '../epicenter.config';
await tabManager.whenReady;
tabManager.tables.devices.set({ ... });
await tabManager.dispose();
```

No CLI feature needed—`bun run scripts/seed.ts` works today.

## Remaining known smells (low priority)

- `workspace-command.ts` (434 lines) has redundant config existence checks before `loadConfig` (which already throws). Minor UX difference in error messages.
- `data-command.ts` has 8 `as unknown as CommandModule` casts for yargs typing workarounds.
- `open-workspace.ts`'s `withWorkspace` has only 1 caller. Could inline, but it's also a clean public API.
