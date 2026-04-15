# HANDOFF: Cell-Level CRDT Merging Implementation

> **STATUS: ✅ COMPLETE** - Implemented in commit `4aae08969`. All tests passing (242 pass, 2 skip).

## Task Overview

Refactor the table storage architecture to support **cell-level CRDT merging** instead of row-level last-writer-wins.

**Current problem**: Two users editing different columns of the same row → one user's changes are lost.

**Solution**: Change from `table=YKeyValue<rowId, rowBlob>` to `table=Y.Map<rowId, YKeyValue<columnName, cellValue>>`.

## Specification

Read the full spec first:

```
specs/20260107T114209-cell-level-crdt-merging.md
```

## Proof of Concept

A working test proves the architecture works:

```
packages/epicenter/src/core/tables/create-tables.crdt-sync.test.ts
```

Run it: `bun test create-tables.crdt-sync.test.ts` from `packages/epicenter/`

The tests demonstrate:

- Concurrent edits to different columns merge correctly
- Same-column edits use last-writer-wins
- Partial updates preserve unmentioned fields

## Key Files to Understand

Before implementing, gather context from these files:

### Primary (must read)

1. **`packages/epicenter/src/core/tables/table-helper.ts`** - Main file to modify. Contains `createTableHelper`, `createTableHelpers`, and all CRUD operations.

2. **`packages/epicenter/src/core/utils/y-keyvalue.ts`** - The YKeyValue implementation. Understand how `set()`, `get()`, `delete()`, and the observer work.

### Secondary (for context)

3. **`packages/epicenter/src/core/tables/create-tables.test.ts`** - Tests for table operations
4. **`packages/epicenter/src/core/tables/create-tables.types.test.ts`** - Type-level tests
5. **`packages/epicenter/src/core/schema/`** - Schema definitions, types like `Row`, `TableSchema`

### Providers (verify they still work)

6. **`packages/epicenter/src/providers/sqlite/sqlite-provider.ts`** - Syncs YJS → SQLite
7. **`packages/epicenter/src/providers/markdown/markdown-provider.ts`** - Syncs YJS → markdown files

## Architecture Change

### Current Structure

```typescript
// table-helper.ts line ~115
const ytables = ydoc.getMap<Y.Array<{ key: string; val: Row }>>('tables');

// Each table is a YKeyValue (Y.Array) keyed by rowId
// Each entry: { key: rowId, val: entireRowAsJsonBlob }
```

### New Structure

```typescript
const ytables =
	ydoc.getMap<Y.Map<string, Y.Array<{ key: string; val: unknown }>>>('tables');

// Each table is a Y.Map keyed by rowId
// Each row is a YKeyValue (Y.Array) keyed by columnName
// Each entry: { key: columnName, val: cellValue }
```

## Implementation Steps

### Step 1: Update Storage Structure

In `createTableHelper`:

- Change how `ytables` is typed
- Change how individual tables are accessed (Y.Map instead of Y.Array)
- Each row becomes its own YKeyValue

### Step 2: Update CRUD Methods

**`upsert(rowData)`**:

```typescript
// Get or create row Y.Array
let rowArray = tableMap.get(rowData.id);
if (!rowArray) {
	rowArray = new Y.Array();
	tableMap.set(rowData.id, rowArray);
}
const rowKV = new YKeyValue(rowArray);

// Set each cell
for (const [columnName, value] of Object.entries(rowData)) {
	rowKV.set(columnName, value);
}
```

**`update(partialRow)`**:

```typescript
const rowArray = tableMap.get(partialRow.id);
if (!rowArray) return { status: 'not_found' };

const rowKV = new YKeyValue(rowArray);
for (const [columnName, value] of Object.entries(partialRow)) {
	rowKV.set(columnName, value);
}
// Note: cells not in partialRow are automatically preserved!
```

**`get(id)`**:

```typescript
const rowArray = tableMap.get(id);
if (!rowArray) return { status: 'not_found', id };

const rowKV = new YKeyValue(rowArray);
const row = {} as Row;
for (const [key, entry] of rowKV.map.entries()) {
	row[key] = entry.val;
}
// Validate and return
```

**`delete(id)`**:

```typescript
if (!tableMap.has(id)) return { status: 'not_found' };
tableMap.delete(id);
return { status: 'deleted' };
```

### Step 3: Update Observer

The `observeChanges` method is more complex now:

- Observe table Y.Map for row add/delete
- For each row, observe its YKeyValue for cell changes
- Track observers to clean up when rows are deleted

### Step 4: Run Tests

```bash
cd packages/epicenter
bun test
```

Fix any failures. The core logic tests should guide what behavior to preserve.

### Step 5: Verify Providers

Run the full test suite and manually verify:

- SQLite provider can read the new structure
- Markdown provider can read the new structure

## Gotchas

1. **YKeyValue caching**: In current code, `getYKeyValue()` caches the YKeyValue instance. With the new structure, you may need to cache per-row.

2. **Transaction wrapping**: Batch multiple cell updates in `ydoc.transact()` for efficiency.

3. **Observer lifecycle**: When a row is deleted, any observers on its YKeyValue should be cleaned up.

4. **Empty rows**: Decide behavior if all cells are deleted from a row. Should the row Y.Map entry be removed?

5. **Schema validation**: The validator in `get()` expects a full row object. Reconstruct it correctly.

## Commands

```bash
# Run all epicenter tests
cd packages/epicenter && bun test

# Run specific test file
cd packages/epicenter/src/core/utils && bun test y-keyvalue-concurrent.test.ts

# Run table tests
cd packages/epicenter/src/core/tables && bun test

# Type check
cd packages/epicenter && bun run typecheck
```

## Success Verification

After implementation, this test should pass:

```typescript
// Two users edit different columns concurrently
user1.tables.posts.update({ id: 'row-1', title: 'New Title' });
user2.tables.posts.update({ id: 'row-1', views: 100 });

// After sync, BOTH changes should be preserved
expect(posts.get('row-1')).toEqual({
	id: 'row-1',
	title: 'New Title', // User 1's change
	views: 100, // User 2's change
});
```

## Questions?

If anything is unclear, search the codebase for:

- `YKeyValue` - understand the key-value abstraction
- `getYKeyValue` - see how it's currently used
- `observeChanges` - understand the observer pattern
- `y-keyvalue.ts` comments - detailed explanation of the CRDT strategy
