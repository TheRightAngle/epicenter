# Dynamic Workspace API Simplification

**Status**: In Progress (2026-01-31)

Simplify the dynamic workspace API with cell-first primitives and removal of dead code.

## Background

The current dynamic workspace API (`src/dynamic/`) needs refinement:

1. **Row-only API**: No cell-level access despite cell-level storage (spreadsheet use case)
2. **Bloated WorkspaceClient**: `epoch` on client when it belongs to HeadDoc
3. **Type bloat**: Redundant aliases (KV types that mirror row types), unused types

### What's Already Good

| Aspect             | Status                                                        |
| ------------------ | ------------------------------------------------------------- |
| Flat row shape     | Done — `{ id, title, views }` with no wrapper                 |
| `batch()` works    | Done — uses `ydoc.transact()`                                 |
| Cell-level storage | Done — YKeyValueLww with `rowId:fieldId` keys                 |
| Result types       | Good — `ValidRowResult`, `InvalidRowResult`, `NotFoundResult` |

## Goals

1. **Cell-first primitives**: Add cell-level access as PRIMARY API (spreadsheet use case)
2. **Row-level as convenience**: Keep row operations as-is
3. **Slim WorkspaceClient**: Remove `epoch` (pass HeadDoc instead)
4. **Remove dead types**: Delete unused/redundant type definitions

## Non-Goals

- Renaming result types (current names are fine)
- Changing result type field names (`row`, `id` are descriptive)
- Changing the underlying Y.Doc storage structure
- Changing table access pattern (`tables.get('posts')` stays)

---

## API Design

### Result Types (Keep Current)

Keep existing result types — they're well-named and work:

```typescript
// packages/epicenter/src/dynamic/tables/table-helper.ts

type ValidRowResult<TRow> = { status: 'valid'; row: TRow };

type InvalidRowResult = {
	status: 'invalid';
	id: string;
	tableName: string;
	errors: ValidationError[];
	row: unknown;
};

type NotFoundResult = {
	status: 'not_found';
	id: string;
	row: undefined;
};

type RowResult<TRow> = ValidRowResult<TRow> | InvalidRowResult;
type GetResult<TRow> = RowResult<TRow> | NotFoundResult;
```

### Cell Operations (New — Primary API)

Add cell-level operations. These become the PRIMARY primitives since storage is already cell-based.

```typescript
type TableHelper = {
	// ═══════════════════════════════════════════════════════════════════════════
	// CELL OPERATIONS (Primary — NEW)
	// ═══════════════════════════════════════════════════════════════════════════

	/** Get a cell value */
	getCell(rowId: string, fieldId: string): CellValue | undefined;

	/** Set a cell value */
	setCell(rowId: string, fieldId: string, value: CellValue): void;

	/** Delete a cell */
	deleteCell(rowId: string, fieldId: string): void;

	/** Check if a cell exists */
	hasCell(rowId: string, fieldId: string): boolean;

	// ═══════════════════════════════════════════════════════════════════════════
	// ROW OPERATIONS (Convenience — renamed for clarity)
	// ═══════════════════════════════════════════════════════════════════════════

	/** Get a row by ID (validates all cells) */
	get(id: string): GetResult<Row>; // Keep current name

	/** Insert or update a row */
	upsert(row: Row): void; // Keep current name

	/** Update specific fields of an existing row */
	update(partialRow: PartialRow): UpdateResult; // Keep current name

	/** Delete a row (all its cells). Fire-and-forget — no-op if missing. */
	delete(id: string): void;

	// ═══════════════════════════════════════════════════════════════════════════
	// BULK OPERATIONS (Keep current)
	// ═══════════════════════════════════════════════════════════════════════════

	getAll(): RowResult<Row>[];
	getAllValid(): Row[];
	getAllInvalid(): InvalidRowResult[];
	upsertMany(rows: Row[]): void;
	updateMany(partialRows: PartialRow[]): UpdateManyResult;
	deleteMany(ids: string[]): DeleteManyResult;
	clear(): void;
	count(): number;
	has(id: string): boolean;
	filter(predicate: (row: Row) => boolean): Row[];
	find(predicate: (row: Row) => boolean): Row | null;

	// ═══════════════════════════════════════════════════════════════════════════
	// OBSERVATION (Keep current)
	// ═══════════════════════════════════════════════════════════════════════════

	observe(
		callback: (changedIds: Set<string>, transaction: Y.Transaction) => void,
	): () => void;
};
```

**Design Decision**: Cell operations use `Cell` suffix (`getCell`, `setCell`) to distinguish from row operations. Row operations keep current names since they're already clear.

### HeadDoc Integration (Epoch Removal)

**Problem**: `epoch` is currently passed directly to `createWorkspaceDoc`, but it should come from `HeadDoc`.

**Solution**: Pass `HeadDoc` to `createWorkspaceDoc` and extract epoch internally using `getOwnEpoch()`.

```typescript
// BEFORE
const workspaceDoc = createWorkspaceDoc({
	workspaceId: 'my-workspace',
	epoch: 1,  // Where does this come from?
	tables: [...],
	kv: [...],
});

// AFTER
const workspaceDoc = createWorkspaceDoc({
	headDoc,  // HeadDoc instance
	tables: [...],
	kv: [...],
});

// Internally:
// - workspaceId = headDoc.workspaceId
// - epoch = headDoc.getOwnEpoch()  // THIS client's epoch, not global max
// - Y.Doc guid = `${workspaceId}-${epoch}`
```

**Why `getOwnEpoch()` not `getEpoch()`?**

- `getEpoch()` returns the **global max** across all collaborators
- `getOwnEpoch()` returns **this client's** epoch

Each client can view a different epoch:

- Client A might be viewing epoch 2 (set via `headDoc.setOwnEpoch(2)`)
- Client B might be viewing epoch 3 (the global max)
- Both are valid; HeadDoc tracks each client's own epoch

**Benefits**:

- Single source of truth for workspace identity
- No manual epoch passing
- Per-client epoch viewing (rollback, historical viewing)
- HeadDoc controls the epoch lifecycle

---

## Types to Delete

```typescript
// DELETE - just aliases, use the originals
type KvGetResult<TValue> = ...;
type ValidKvResult<TValue> = ...;
type InvalidKvResult = ...;
type NotFoundKvResult = ...;

// DELETE - unused
type TypedCell = ...;
type TypedRowWithCells = ...;

// DELETE - just re-export directly
type FieldDefinition = Field;
type TableDef = TableDefinition;
type KvDefinition = KvField;
type WorkspaceDef = CoreWorkspaceDefinition;
type FieldType = CoreFieldType;
```

---

## Open Questions (All Resolved)

### 1. ~~Should `batch()` be removed?~~ RESOLVED

**Answer**: No, it works. Uses `ydoc.transact()` correctly.

### 2. ~~Should epoch be on client?~~ RESOLVED

**Answer**: No, remove it. Pass HeadDoc to createWorkspaceDoc instead.

### 3. ~~table() vs tables.get()?~~ RESOLVED

**Answer**: Keep `tables.get('posts')` — familiar pattern, no change needed.

### 4. ~~Rename result types?~~ RESOLVED

**Answer**: No, keep current names. `ValidRowResult`, `InvalidRowResult`, etc. are fine.

---

## Success Criteria

- [x] Cell operations added: `getCell()`, `setCell()`, `deleteCell()`, `hasCell()`
- [x] ~~Table access changed to function call~~ — Cancelled, keeping `tables.get()`
- [x] `createWorkspaceDoc` accepts `HeadDoc` instead of raw `epoch` (uses `getOwnEpoch()`)
- [ ] Unused type aliases deleted
- [ ] Tests updated and passing
- [ ] Documentation updated

---

## Review

### 2026-01-31: Cell Operations Complete

Added cell-level operations to both `TableHelper` and `UntypedTableHelper`:

- `getCell(rowId, fieldId)` — Get a single cell value
- `setCell(rowId, fieldId, value)` — Set a single cell value
- `deleteCell(rowId, fieldId)` — Delete a cell
- `hasCell(rowId, fieldId)` — Check if cell exists

These work directly with `YKeyValueLww` using `CellKey(RowId(rowId), FieldId(fieldId))`.

### 2026-01-31: Table Access Pattern Kept

Originally planned to change `tables.get('posts')` to `tables('posts')`. After implementation, decided to keep the original `tables.get()` pattern — it's familiar and works well.

### 2026-01-31: HeadDoc Integration Complete

Changed `createWorkspaceDoc` to accept `headDoc` instead of `workspaceId` and `epoch`:

- `workspaceId` extracted from `headDoc.workspaceId`
- `epoch` extracted from `headDoc.getOwnEpoch()` (this client's epoch, not global max)
- Y.Doc guid remains `${workspaceId}-${epoch}`

This enables per-client epoch viewing — one client can view epoch 2 while another views epoch 3.

### Remaining Work

1. **Type cleanup**: Delete unused type aliases (KvGetResult, TypedCell, etc.)
2. **Verification**: Run tests and typecheck (238 pre-existing errors unrelated to this change)
