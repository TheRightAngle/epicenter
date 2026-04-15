# @epicenter/ai

`@epicenter/ai` turns Epicenter workspace actions into LLM-callable tools. It exists because the browser owns the real action handlers, while the chat server only sees JSON over the wire. Apps like Opensidian use this package to keep the execution logic local, send tool definitions to the server, and let the model call workspace actions without hardcoding every tool twice.

## Quick usage

This is the pattern from `apps/opensidian/src/lib/client.ts`:

```typescript
import { actionsToClientTools, toToolDefinitions } from '@epicenter/ai';

export const workspaceTools = actionsToClientTools(workspace.actions);
export const workspaceDefinitions = toToolDefinitions(workspaceTools);
```

Under the hood, that split is the whole point:

```text
workspace.actions
  └─ actionsToClientTools(...)   -> client tools with execute()
  └─ toToolDefinitions(...)      -> JSON payload for the server
```

The first result stays in the browser. The second goes into the request body so the server can tell TanStack AI which tools exist.

## How the bridge works

Workspace actions are nested objects. `actionsToClientTools()` walks that tree with `iterateActions()` from `@epicenter/workspace`, joins path segments with `_`, and returns TanStack AI client tools.

Queries become ordinary client tools. Mutations automatically get `needsApproval: true`, which is how the UI knows not to run destructive actions silently.

`toToolDefinitions()` then strips runtime-only fields like `execute` and `__toolSide`. What survives is the wire-safe shape the server needs: tool name, description, schemas, approval metadata, and any extra metadata attached to the tool.

One detail matters more than it looks. Input schemas are normalized so `properties` and `required` are always present. The source calls out Anthropic here—some providers reject schemas that omit those keys.

## API overview

### `actionsToClientTools(actions)`

Converts a workspace action tree into TanStack AI client tools. Tool names come from the action path, so a nested action like `tabs.close` becomes `tabs_close`.

### `toToolDefinitions(tools)`

Converts client tools into plain JSON definitions for the HTTP request body. This removes non-serializable fields and keeps the data the server needs for tool-aware chat calls.

### `ActionNames<TActions>`

Type-level helper that turns a nested action tree into a string union of tool names.

```typescript
type Names = ActionNames<typeof workspace.actions>;
// "tabs_search" | "tabs_close" | ...
```

### `ToolDefinitionPayload`

The wire-safe tool shape produced by `toToolDefinitions()`. It matches the transport boundary: name, optional title, description, schemas, approval flag, and metadata.

## Relationship to the monorepo

`@epicenter/ai` sits between `@epicenter/workspace` and chat clients built on `@tanstack/ai`.

- `@epicenter/workspace` defines actions and exposes `iterateActions()`.
- `@epicenter/ai` adapts those actions into client tools and wire payloads.
- Apps like `apps/opensidian` feed the client tools into local chat execution and send the stripped definitions to the API.

If you already have a workspace with actions, this package gives you the missing adapter layer. Nothing more.

## Source entry point

The package exports these symbols from `src/index.ts`:

```typescript
export {
	type ActionNames,
	actionsToClientTools,
	type ToolDefinitionPayload,
	toToolDefinitions,
} from './tool-bridge';
```

## License

MIT
