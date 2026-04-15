# Epicenter architecture
Epicenter is one composition story. The core packages define the local-first model, the middle layer turns that model into app-shaped tools, and the apps decide which pieces to compose.
The lifecycle is define→create→extend→sync. That order matters because Epicenter keeps schema definition pure, pushes side effects to the edge, and lets each app choose how much runtime machinery it needs.
This is the five-minute map. It explains how the packages interlock without redoing the full `@epicenter/workspace` README.

## The stack in one picture
The dependency shape runs bottom to top. Apps depend on middleware; middleware depends on the core; the core stays small and reusable.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ APPS                                                                         │
│                                                                              │
│ opensidian   whispering   tab-manager   fuji   zhongwen                      │
│ honeycrisp   dashboard    api           landing                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MIDDLEWARE                                                                   │
│                                                                              │
│ @epicenter/svelte      (packages/svelte-utils)                               │
│ @epicenter/filesystem                                                        │
│ @epicenter/skills                                                            │
│ @epicenter/ai                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CORE                                                                         │
│                                                                              │
│ @epicenter/workspace   @epicenter/sync   @epicenter/constants   @epicenter/ui│
└──────────────────────────────────────────────────────────────────────────────┘
```
`@epicenter/workspace` is the center of gravity. It defines the schema layer, creates the live Yjs-backed client, owns the extension lifecycle, and exposes tables, KV, documents, awareness, and actions.
`@epicenter/sync` is the wire format, not the app model. It exports protocol primitives like `encodeSyncStep1`, `encodeSyncUpdate`, `decodeSyncMessage`, and shared RPC error types so server and client can speak the same binary language without duplicating protocol logic.
`@epicenter/constants` is the routing glue. It gives apps one source of truth for URLs, ports, and versioning so sync endpoints, auth URLs, and cross-app links do not drift.
`@epicenter/ui` is the shared presentation layer. It knows Svelte components, not Yjs semantics.
The middleware layer is where workspace data starts feeling like an application. `@epicenter/svelte` turns workspace helpers into reactive Svelte state, `@epicenter/filesystem` turns workspace rows and documents into a POSIX-style filesystem, `@epicenter/skills` proves that whole workspaces can be packaged and embedded as data products, and `@epicenter/ai` bridges workspace actions into LLM-callable tools.
The apps are thin by comparison. Each app picks a definition, creates a client, installs the extensions it needs, and layers UI or transport concerns on top.

## The lifecycle: define → create → extend → sync
The four verbs are the architecture. If you remember nothing else, remember that Epicenter keeps those stages separate on purpose.

### 1. Define is pure
`defineTable`, `defineKv`, and `defineWorkspace` are pure declarations. They do not create a `Y.Doc`, open IndexedDB, start a WebSocket, or touch the network.

```ts
import { type } from 'arktype';
import {
	defineKv,
	defineTable,
	defineWorkspace,
} from '@epicenter/workspace';

const files = defineTable(
	type({
		id: 'string',
		name: 'string',
		_v: '1',
	}),
);

const themeMode = defineKv(type("'light' | 'dark' | 'system'"), 'system');

export const appDefinition = defineWorkspace({
	id: 'example.app',
	tables: { files },
	kv: { themeMode },
});
```

That purity is what makes cross-package reuse work. The same definition can be imported by an app, a CLI tool, a migration utility, a test, or another package without dragging runtime side effects along for the ride.

### 2. Create is where the live client appears
`createWorkspace()` is the boundary where static meaning turns into live state. This is where the root `Y.Doc` gets created, the guid is set from the workspace id, table helpers and KV helpers get wired up, awareness is created, and document managers are prepared for any `.withDocument()` tables.

```ts
import { createWorkspace } from '@epicenter/workspace';

const workspace = createWorkspace(appDefinition);

workspace.tables.files.set({
	id: 'readme.md',
	name: 'README.md',
	_v: 1,
});
```

The split is conceptual, not cosmetic. Definitions describe what data means; `createWorkspace()` creates the runtime that can actually hold and mutate that data.

### 3. Extend is where persistence, sync, indexing, and materializers attach
The extension chain is the plugin system. `createWorkspace()` returns a client you can use immediately, but also a builder with `.withExtension()`, `.withWorkspaceExtension()`, `.withDocumentExtension()`, and `.withActions()`.

```ts
import { createWorkspace } from '@epicenter/workspace';
import { indexeddbPersistence } from '@epicenter/workspace/extensions/persistence/indexeddb';
import { createSyncExtension } from '@epicenter/workspace/extensions/sync/websocket';

const workspace = createWorkspace(appDefinition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('sync', createSyncExtension({
		url: (id) => `wss://sync.example.com/workspaces/${id}`,
	}));
```

`.withExtension()` is broad on purpose. It registers the same factory for the root workspace doc and for per-document docs, which is what you want for capabilities like persistence or sync that should follow both the workspace and any attached document timelines.

`.withWorkspaceExtension()` is narrower and richer. Its factory receives the full workspace context—`tables`, `kv`, `documents`, `definitions`, `awareness`, `extensions`, `batch`, `loadSnapshot`, and `whenReady`—so it is the right place for indexes, materializers, or any adapter that needs the typed workspace surface.

`.withDocumentExtension()` is the per-document hook. That one attaches behavior to content documents opened through `workspace.documents`, which is how file content, note bodies, or other rich per-row docs get their own sync or transformation layers.

Extensions compose progressively. Later extensions see earlier exports through `context.extensions`, because each builder step accumulates the extension map before the next one runs.

```ts
const workspace = createWorkspace(appDefinition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('sync', createSyncExtension({ url }))
	.withWorkspaceExtension('search', ({ extensions, tables }) => {
		void extensions.persistence;
		void extensions.sync;
		void tables;

		return {
			search(query: string) {
				return query;
			},
		};
	});
```

That ordering is not trivia. It lets apps build capability stacks instead of monoliths, and it lets packages like `@epicenter/filesystem` or app-specific indexes sit on top of the same base client without forking core behavior.

### 4. Sync is just another extension, but it changes the topology
Sync does not own the workspace. It attaches to a workspace that already exists and starts moving CRDT updates between clients.

```ts
const workspace = createWorkspace(appDefinition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('sync', createSyncExtension({
		url: (workspaceId) => `wss://host/workspaces/${workspaceId}`,
		getToken: async () => auth.token,
	}));
```

That ordering is deliberate. Local state exists first, then optional durability, then optional network coordination.

## The async boundary is `whenReady`
`createWorkspace()` is synchronous, but extension setup is not. The workspace object exists right away; `workspace.whenReady` is the promise that says all registered extension `whenReady` hooks have settled.

```ts
const workspace = createWorkspace(appDefinition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('sync', createSyncExtension({ url }));

await workspace.whenReady;
```

That promise is the line between construction and full availability. If persistence needs to hydrate local state, or sync needs to wait on something upstream, `whenReady` is where callers pause. The pattern is simple: create now, await later.

## Disposal runs in reverse
Teardown is LIFO. The workspace closes open document handles first, then runs extension cleanup in reverse registration order, then destroys awareness and the root `Y.Doc`.

```ts
await workspace.dispose();
```
```text
dispose()
  │
  ├─ close open document handles first
  │
  ├─ dispose extension C
  ├─ dispose extension B
  ├─ dispose extension A
  │
  └─ destroy awareness and root Y.Doc
```

Reverse order is the only sane rule here. If sync depends on persistence, or a materializer depends on both, the most recently attached layer should shut down before the layers under it disappear.

## Write and read flow
Writes always hit Yjs first. Everything else reacts to that state instead of becoming a competing source of truth.

```text
WRITE FLOW

app code / action / UI event
            │
            ▼
   workspace.tables / kv / documents
            │
            ▼
          Y.Doc
            │
   ┌────────┼───────────────┬───────────────┐
   ▼        ▼               ▼               ▼
persistence sync       sqlite index   markdown/file views
IndexedDB   WebSocket  or search      or other materializers
SQLite      relay      extensions     built from workspace data
```

Reads split by purpose. Simple reads stay in the workspace client, while derived reads can come from extension exports built on top of that same client state.

```text
READ FLOW

          Y.Doc
            │
   ┌────────┼───────────────────┬────────────────────────┐
   ▼        ▼                   ▼                        ▼
tables      kv             documents                 extensions
typed rows  settings       per-row content docs      indexes/materializers
   │         │                   │                        │
   └─────────┴───────────────────┴────────────────────────┘
                             │
                             ▼
                          app UI
```

That model is why Epicenter can mix SQL-like lookup, filesystem semantics, and collaborative document editing without splitting the truth into three different stores. They are three views over one CRDT core.

## Opensidian is the best concrete example
Opensidian composes nearly every layer at once. Its schema starts with `filesTable` from `@epicenter/filesystem`, adds chat tables locally, and exports one pure workspace definition.

```ts
import { filesTable } from '@epicenter/filesystem';
import { defineTable, defineWorkspace } from '@epicenter/workspace';

const conversationsTable = defineTable(/* ... */);
const chatMessagesTable = defineTable(/* ... */);
const toolTrustTable = defineTable(/* ... */);

export const opensidianDefinition = defineWorkspace({
	id: 'opensidian',
	tables: {
		files: filesTable,
		conversations: conversationsTable,
		chatMessages: chatMessagesTable,
		toolTrust: toolTrustTable,
	},
});
```

Its runtime client then layers persistence, sync, and a workspace-only SQLite search index. This comes straight from `apps/opensidian/src/lib/client.ts`.

```ts
export const workspace = createWorkspace(opensidianDefinition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('sync', createSyncExtension({
		url: (workspaceId) => toWsUrl(`${APP_URLS.API}/workspaces/${workspaceId}`),
		getToken: async () => auth.token,
	}))
	.withWorkspaceExtension('sqliteIndex', createSqliteIndex())
	.withActions((client) => ({
		files: {
			search: defineQuery({
				handler: async ({ query }) => client.extensions.sqliteIndex.search(query),
			}),
		},
	}));
```

That workspace then feeds other middleware packages. `createYjsFileSystem(workspace.tables.files, workspace.documents.files.content)` turns the files table plus content docs into a real virtual filesystem; `actionsToClientTools(workspace.actions)` from `@epicenter/ai` turns workspace actions into chat tools; `createSkillsWorkspace()` mounts a second skills-focused workspace; `createAuth()` from `@epicenter/svelte` coordinates auth with encryption and sync reconnects.
The dependency chain looks like this.
```text
opensidianDefinition
    │
    ▼
createWorkspace(...)
    │
    ├─ persistence extension
    ├─ sync extension
    ├─ sqliteIndex extension
    └─ workspace actions
    │
    ├─ createYjsFileSystem(...)       -> editor + terminal + file tree
    ├─ actionsToClientTools(...)      -> local AI tool execution
    ├─ toToolDefinitions(...)         -> wire payload for chat requests
    ├─ createSkillsWorkspace(...)     -> shared skills data source
    └─ fromTable / fromKv / auth      -> reactive Svelte app state
```

That is the whole monorepo in miniature. The app is mostly composition code because the packages under it already agree on the same runtime shape.

## The sync philosophy is dumb server, smart client
The server is a relay, not the authority. Clients own schema meaning, table helpers, migrations, encryption activation, action handlers, and most of the user-facing behavior.

`@epicenter/sync` reflects that philosophy in its API. It exports protocol encode/decode functions and shared error types, while the higher-level workspace sync extension plugs those primitives into a live client that already knows how to read and write its own data.

That means the server does not need to understand your tables. It forwards Yjs sync messages, awareness updates, and RPC payloads, but it does not become the canonical interpreter of the workspace schema.

This is what “smart client” means here. The client can boot locally, read persisted state, apply encryption keys, expose actions, open document timelines, and keep working offline before the network helps at all.

This is what “dumb server” means here. The server helps peers find each other and exchange updates, but it is not where the data model becomes valid or meaningful.

## The shortest accurate mental model
Epicenter defines data first. `@epicenter/workspace` gives that data a live Yjs client, extensions attach durability and transport, middleware packages reinterpret the same client for files, skills, Svelte state, and AI tools, and the apps compose those layers into actual products.

Everything after that is detail. Useful detail, but still detail.
