# Table Migrations

## When to Read This

Read when adding table versions, writing `.migrate()` functions, or validating migration style and anti-patterns.

## Table Migration Function Rules

1. Input type is a union of all version outputs
2. Return type is the latest version output
3. Use `switch (row._v)` for discrimination (tables always have `_v`)
4. Final case returns `row` as-is (already latest)
5. Always migrate directly to latest (not incrementally through each version)

## Table Anti-Patterns

### Incremental migration (v1 -> v2 -> v3)

```typescript
// BAD: Chains through each version
.migrate((row) => {
  let current = row;
  if (current._v === 1) current = { ...current, views: 0, _v: 2 };
  if (current._v === 2) current = { ...current, tags: [], _v: 3 };
  return current;
})

// GOOD: Migrate directly to latest
.migrate((row) => {
  switch (row._v) {
    case 1: return { ...row, views: 0, tags: [], _v: 3 };
    case 2: return { ...row, tags: [], _v: 3 };
    case 3: return row;
  }
})
```

### Note: `as const` is unnecessary

TypeScript contextually narrows `_v: 2` to the literal type based on the return type constraint. Both of these work:

```typescript
return { ...row, views: 0, _v: 2 }; // Works — contextual narrowing
return { ...row, views: 0, _v: 2 as const }; // Also works — redundant
```

### Rules

1. **Every table gets its own ID type**: `DeviceId`, `SavedTabId`, `ConversationId`, `ChatMessageId`, etc.
2. **Foreign keys use the referenced table's ID type**: `chatMessages.conversationId` uses `ConversationId`, not `'string'`
3. **Optional FKs use `.or('undefined')`**: `'parentId?': ConversationId.or('undefined')`
4. **Composite IDs are also branded**: `TabCompositeId`, `WindowCompositeId`, `GroupCompositeId`
5. **Use generator functions**: When IDs are generated at runtime, use a `generate*` factory: `generateConversationId()`. Never scatter double-casts across call sites.
6. **Functions accept branded types**: `function switchConversation(id: ConversationId)` not `(id: string)`

### Why Not Plain `'string'`

```typescript
// BAD: Nothing prevents mixing conversation IDs with message IDs
function deleteConversation(id: string) { ... }
deleteConversation(message.id);  // Compiles! Silent bug.

// GOOD: Compiler catches the mistake
function deleteConversation(id: ConversationId) { ... }
deleteConversation(message.id);  // Error: ChatMessageId is not ConversationId
```

### Reference Implementation

See `apps/tab-manager/src/lib/workspace.ts` for the canonical example with 7 branded ID types and 4 generator functions.
See `packages/filesystem/src/ids.ts` for the reference factory pattern (`generateRowId`, `generateColumnId`, `generateFileId`).
See `specs/20260312T180000-branded-id-convention.md` for the full inventory and migration plan.

### Pattern

```typescript
import {
	createWorkspace,
	defineTable,
	defineWorkspace,
	type InferTableRow,
} from '@epicenter/workspace';

// ─── Tables (each followed by its type export) ──────────────────────────

const usersTable = defineTable(
	type({
		id: UserId,
		email: 'string',
		_v: '1',
	}),
);
export type User = InferTableRow<typeof usersTable>;

const postsTable = defineTable(
	type({
		id: PostId,
		authorId: UserId,
		title: 'string',
		_v: '1',
	}),
);
export type Post = InferTableRow<typeof postsTable>;

// ─── Workspace client ───────────────────────────────────────────────────

export const workspaceClient = createWorkspace(
	defineWorkspace({
		id: 'my-workspace',
		tables: {
			users: usersTable,
			posts: postsTable,
		},
	}),
);
```

### Why This Structure

- **Co-located types**: Each `export type` sits right below its `defineTable` — easy to verify 1:1 correspondence, easy to remove both together.
- **Error co-location**: If you forget `_v` or `id`, the error shows on the `defineTable()` call right next to the schema — not buried inside `defineWorkspace`.
- **Schema-agnostic inference**: `InferTableRow` works with any Standard Schema (arktype, zod, etc.) and handles migrations correctly (always infers the latest version's type).
- **Fast type inference**: `InferTableRow<typeof usersTable>` resolves against a standalone const. Avoids the expensive `InferTableRow<NonNullable<(typeof definition)['tables']>['key']>` chain that forces TS to resolve the entire `defineWorkspace` return type.
- **No intermediate `definition` const**: `defineWorkspace({...})` is inlined directly into `createWorkspace()` since it's only used once.

### Anti-Pattern: Inline Tables + Deep Indirection

```typescript
// BAD: Tables inline in defineWorkspace, types derived through deep indirection
const definition = defineWorkspace({
	tables: {
		users: defineTable(type({ id: 'string', email: 'string', _v: '1' })),
	},
});
type Tables = NonNullable<(typeof definition)['tables']>;
export type User = InferTableRow<Tables['users']>;

// GOOD: Extract table, co-locate type, inline defineWorkspace
const usersTable = defineTable(type({ id: UserId, email: 'string', _v: '1' }));
export type User = InferTableRow<typeof usersTable>;

export const workspaceClient = createWorkspace(
	defineWorkspace({ tables: { users: usersTable } }),
);
```
