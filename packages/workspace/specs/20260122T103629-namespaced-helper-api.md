# Callable Helper API

**Date:** 2026-01-22
**Status:** Draft
**Scope:** `kv`, `tables`, `schema` helper APIs

## Summary

Refactor all helper APIs (kv, tables, schema) to be **callable functions with properties**. The collection itself is a function that returns a helper, while utility methods are properties on that function. This eliminates collision risk, removes the need for `$` prefixes, and provides an ergonomic API.

## Problem

Current API mixes user-defined names with utility methods via flat spreading:

```typescript
// Current: tables spreads helpers directly
tables.posts; // TableHelper (user-defined)
tables.clearAll(); // Utility method
tables.raw; // Escape hatch
tables.definitions; // Metadata
tables.table('posts'); // Dynamic accessor (redundant?)
```

Issues:

1. **Collision risk**: If user defines a table named `raw`, `definitions`, `clearAll`, `table`, `has`, etc., it collides
2. **Inconsistent `$` prefix**: schema uses `$raw`, kv/tables use `raw`
3. **Redundant accessors**: `tables.posts` and `tables.table('posts')` do the same thing
4. **Asymmetric APIs**: tables has `definedNames()`, kv doesn't; kv has `toJSON()`, tables doesn't

## Solution

Make the collection itself a **callable function**. Call it with a name to get a helper. Utility methods are properties on the function.

```typescript
// NEW: tables is a function
tables('posts'); // TableHelper<PostsFields> - always returns helper (creates if needed)
tables('custom'); // UntypedTableHelper - dynamic table, no type info

// Utilities are properties on the function
tables.has('posts'); // boolean
tables.names(); // string[]
tables.clear(); // void
tables.raw; // Y.Map escape hatch
```

### Design Principles

1. **Collection is callable**: `tables('posts')`, `kv('theme')`, `schema.tables('posts')`
2. **Always returns a helper**: No `undefined`, no `getOrThrow`. Creates table/kv entry if needed.
3. **No collision possible**: User names only appear as function arguments
4. **No `$` prefix needed**: Utilities are clearly properties, not mixed with user data
5. **Consistent across all helpers**: Same callable pattern for kv, tables, schema sub-helpers

## New API Specification

### Tables Helper (`createTables`)

```typescript
// ═══════════════════════════════════════════════════════════════════
// CALLABLE - PRIMARY ACCESS
// ═══════════════════════════════════════════════════════════════════

// tables is a function
tables('posts'); // TableHelper<PostsFields>
// If 'posts' is in definitions: returns typed helper
// If not in definitions: returns UntypedTableHelper
// Creates the Y.Map if it doesn't exist

// Overload signatures:
// tables<K extends keyof TDefinitions>(name: K): TableHelper<TDefinitions[K]['fields']>
// tables(name: string): UntypedTableHelper

// ═══════════════════════════════════════════════════════════════════
// EXISTENCE & ENUMERATION (properties on the function)
// ═══════════════════════════════════════════════════════════════════

tables.has('posts'); // boolean - exists in YJS storage (not just definitions)

tables.names(); // string[] - all table names currently in YJS
tables.all(); // UntypedTableHelper[] - helpers for all existing tables

tables.definedNames(); // (keyof TDefinitions)[] - names from schema definitions
tables.defined(); // TableHelper[] - helpers for schema-defined tables only

// ═══════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════

tables.clear(); // void - clear all rows in all defined tables
tables.drop('posts'); // boolean - delete table entirely from YJS

// ═══════════════════════════════════════════════════════════════════
// METADATA & ESCAPE HATCHES
// ═══════════════════════════════════════════════════════════════════

tables.definitions; // TTableDefinitionMap - the raw schema definitions
tables.raw; // TablesMap (Y.Map<TableMap>) - direct YJS access

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

tables.toJSON(); // Record<tableName, Row[]> - serialize all tables
tables.zip(configs); // Array<{name, table, paired}> - correlate with config object
```

### Per-Table Helper (`tables('posts')`)

```typescript
const posts = tables('posts');

posts.name; // string
posts.schema; // FieldSchemaMap

// CRUD - unchanged
posts.upsert(row); // void
posts.upsertMany(rows); // void
posts.update(partial); // UpdateResult
posts.updateMany(partials); // UpdateManyResult
posts.get(id); // GetResult<Row>
posts.getAll(); // RowResult<Row>[]
posts.getAllValid(); // Row[]
posts.getAllInvalid(); // InvalidRowResult[]
posts.has(id); // boolean
posts.delete(id); // void
posts.deleteMany(ids); // DeleteManyResult
posts.clear(); // void
posts.count(); // number
posts.filter(predicate); // Row[]
posts.find(predicate); // Row | null
posts.observeChanges(cb); // () => void

// Escape hatch & type inference
posts.raw; // TableMap - direct YJS access
posts.inferRow; // type inference helper (was $inferRow)
```

---

### KV Helper (`createKv`)

```typescript
// ═══════════════════════════════════════════════════════════════════
// CALLABLE - PRIMARY ACCESS
// ═══════════════════════════════════════════════════════════════════

// kv is a function
kv('theme'); // KvHelper<ThemeField>
// Always returns the typed helper for defined keys
// TypeScript error if key not in definitions

// Signature:
// kv<K extends keyof TDefinitions>(name: K): KvHelper<TDefinitions[K]['field']>

// ═══════════════════════════════════════════════════════════════════
// EXISTENCE & ENUMERATION
// ═══════════════════════════════════════════════════════════════════

kv.has('theme'); // boolean - value exists in YJS (has been set)
kv.names(); // (keyof TDefinitions)[] - all defined key names
kv.all(); // KvHelper[] - all helpers

// ═══════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════

kv.clear(); // void - reset all to defaults (delete from YJS)

// ═══════════════════════════════════════════════════════════════════
// METADATA & ESCAPE HATCHES
// ═══════════════════════════════════════════════════════════════════

kv.definitions; // TKvDefinitionMap - the raw schema definitions
kv.raw; // KvMap (Y.Map<KvValue>) - direct YJS access

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

kv.toJSON(); // Record<keyName, value> - serialize all values
```

### Per-Key Helper (`kv('theme')`)

```typescript
const theme = kv('theme');

theme.name; // string
theme.field; // FieldSchema

theme.get(); // KvGetResult<T>
theme.set(value); // void
theme.reset(); // void
theme.observeChanges(cb); // () => void

theme.inferValue; // type inference helper (was $inferValue)
```

---

### Schema Helper (`createSchema`)

The schema helper's sub-helpers (`schema.tables`, `schema.kv`) become callable.

```typescript
// ═══════════════════════════════════════════════════════════════════
// ROOT LEVEL
// ═══════════════════════════════════════════════════════════════════

schema.get()               // WorkspaceSchemaMap - full snapshot
schema.merge({...})        // void - bulk add/update
schema.observe(cb)         // () => void - deep observe

schema.tables              // TablesSchemaHelper (callable)
schema.kv                  // KvSchemaHelper (callable)
schema.raw                 // SchemaMap - escape hatch (was $raw)

// ═══════════════════════════════════════════════════════════════════
// TABLES SCHEMA - schema.tables is callable
// ═══════════════════════════════════════════════════════════════════

schema.tables('posts')         // TableSchemaHelper - per-table helper
                               // Creates entry if doesn't exist

// Properties on schema.tables:
schema.tables.get('posts')     // StoredTableSchema | undefined (snapshot, not helper)
schema.tables.getAll()         // Record<string, StoredTableSchema>
schema.tables.set('posts', def) // void
schema.tables.delete('posts')  // boolean
schema.tables.has('posts')     // boolean
schema.tables.keys()           // string[]
schema.tables.observe(cb)      // () => void
schema.tables.raw              // TablesSchemaMap (was $raw)

// ═══════════════════════════════════════════════════════════════════
// PER-TABLE SCHEMA - schema.tables('posts')
// ═══════════════════════════════════════════════════════════════════

schema.tables('posts').get()       // StoredTableSchema
schema.tables('posts').fields      // FieldsHelper (callable)
schema.tables('posts').metadata    // MetadataHelper
schema.tables('posts').raw         // Y.Map (was $raw)

// ═══════════════════════════════════════════════════════════════════
// FIELDS HELPER - schema.tables('posts').fields is callable
// ═══════════════════════════════════════════════════════════════════

schema.tables('posts').fields('title')     // FieldSchema - get single field
schema.tables('posts').fields.get('title') // FieldSchema | undefined
schema.tables('posts').fields.getAll()     // Record<string, FieldSchema>
schema.tables('posts').fields.set('title', def) // void
schema.tables('posts').fields.delete('title')   // boolean
schema.tables('posts').fields.has('title')      // boolean
schema.tables('posts').fields.keys()            // string[]
schema.tables('posts').fields.observe(cb)       // () => void
schema.tables('posts').fields.raw               // FieldsMap (was $raw)

// ═══════════════════════════════════════════════════════════════════
// KV SCHEMA - schema.kv is callable
// ═══════════════════════════════════════════════════════════════════

schema.kv('theme')             // KvSchemaHelper - per-key helper (if we want granular access)
                               // OR just return StoredKvSchema directly

// Properties on schema.kv:
schema.kv.get('theme')         // StoredKvSchema | undefined
schema.kv.getAll()             // Record<string, StoredKvSchema>
schema.kv.set('theme', def)    // void
schema.kv.delete('theme')      // boolean
schema.kv.has('theme')         // boolean
schema.kv.keys()               // string[]
schema.kv.observe(cb)          // () => void
schema.kv.raw                  // KvSchemaMap (was $raw)
```

---

## TypeScript Implementation Pattern

Creating a callable with properties:

```typescript
type TablesFunction = {
	// Call signatures (overloads)
	<K extends keyof TDefinitions>(
		name: K,
	): TableHelper<TDefinitions[K]['fields']>;
	(name: string): UntypedTableHelper;

	// Properties
	has(name: string): boolean;
	names(): string[];
	all(): UntypedTableHelper[];
	definedNames(): (keyof TDefinitions)[];
	defined(): TableHelper<TDefinitions[keyof TDefinitions]['fields']>[];
	clear(): void;
	drop(name: string): boolean;
	definitions: TDefinitions;
	raw: TablesMap;
	toJSON(): Record<string, unknown[]>;
	zip<TConfigs>(
		configs: TConfigs,
	): Array<{
		name: string;
		table: TableHelper;
		paired: TConfigs[keyof TConfigs];
	}>;
};

function createTables<TDefinitions extends TableDefinitionMap>(
	ydoc: Y.Doc,
	definitions: TDefinitions,
): TablesFunction {
	// The callable function
	const tablesAccessor = (name: string) => {
		if (name in definitions) {
			return tableHelpers[name];
		}
		return getOrCreateDynamicHelper(name);
	};

	// Attach properties
	tablesAccessor.has = (name: string) => ytables.has(name);
	tablesAccessor.names = () => Array.from(ytables.keys());
	tablesAccessor.all = () => {
		/* ... */
	};
	tablesAccessor.definedNames = () => Object.keys(definitions);
	tablesAccessor.defined = () => Object.values(tableHelpers);
	tablesAccessor.clear = () => {
		/* ... */
	};
	tablesAccessor.drop = (name: string) => {
		/* ... */
	};
	tablesAccessor.definitions = definitions;
	tablesAccessor.raw = ytables;
	tablesAccessor.toJSON = () => {
		/* ... */
	};
	tablesAccessor.zip = (configs) => {
		/* ... */
	};

	return tablesAccessor as TablesFunction;
}
```

---

## Migration Guide

### Tables

```typescript
// Before
tables.posts.upsert({ id: '1', title: 'Hello' })
tables.posts.getAll()
tables.table('dynamic').upsert({ id: '1', foo: 'bar' })
tables.clearAll()
type PostRow = typeof tables.posts.$inferRow

// After
tables('posts').upsert({ id: '1', title: 'Hello' })
tables('posts').getAll()
tables('dynamic').upsert({ id: '1', foo: 'bar' })
tables.clear()
type PostRow = typeof tables('posts').inferRow

// With destructuring (unchanged ergonomics)
const posts = tables('posts')
posts.upsert({ id: '1', title: 'Hello' })
posts.getAll()
```

### KV

```typescript
// Before
kv.theme.set('dark')
kv.theme.get()
kv.clearAll()
type Theme = typeof kv.theme.$inferValue

// After
kv('theme').set('dark')
kv('theme').get()
kv.clear()
type Theme = typeof kv('theme').inferValue

// With destructuring
const theme = kv('theme')
theme.set('dark')
theme.get()
```

### Schema

```typescript
// Before
schema.$raw;
schema.tables.$raw;
schema.tables.table('posts')!.$raw;
schema.tables.table('posts')!.fields.$raw;

// After
schema.raw;
schema.tables.raw;
schema.tables('posts').raw;
schema.tables('posts').fields.raw;
```

---

## API Comparison Summary

### Changed (spreading to callable)

| Helper        | Before                         | After                    |
| ------------- | ------------------------------ | ------------------------ |
| tables        | `tables.posts`                 | `tables('posts')`        |
| tables        | `tables.table('posts')`        | `tables('posts')`        |
| kv            | `kv.theme`                     | `kv('theme')`            |
| schema.tables | `schema.tables.table('posts')` | `schema.tables('posts')` |

### Renamed

| Helper       | Before        | After        |
| ------------ | ------------- | ------------ |
| tables       | `clearAll()`  | `clear()`    |
| kv           | `clearAll()`  | `clear()`    |
| kv           | `defined()`   | `all()`      |
| table helper | `$inferRow`   | `inferRow`   |
| kv helper    | `$inferValue` | `inferValue` |
| all schema   | `$raw`        | `raw`        |

### Added (for consistency)

| Helper | Method        | Purpose                      |
| ------ | ------------- | ---------------------------- |
| tables | `toJSON()`    | Serialize all tables         |
| kv     | `has('name')` | Check if value exists in YJS |
| kv     | `names()`     | List all defined key names   |

### Removed

| Helper | Removed                        | Reason                  |
| ------ | ------------------------------ | ----------------------- |
| tables | Direct spread (`tables.posts`) | Replaced by callable    |
| tables | `table()` accessor             | Redundant with callable |
| kv     | Direct spread (`kv.theme`)     | Replaced by callable    |

---

## Implementation Checklist

- [ ] **tables/create-tables.ts**:
  - [ ] Convert to callable function pattern
  - [ ] Remove spread of tableHelpers
  - [ ] Remove `table()` accessor (now the function itself)
  - [ ] Rename `clearAll` -> `clear`
  - [ ] Add `toJSON()`

- [ ] **tables/table-helper.ts**:
  - [ ] Rename `$inferRow` -> `inferRow`

- [ ] **kv/core.ts**:
  - [ ] Convert to callable function pattern
  - [ ] Remove spread of kvHelpers
  - [ ] Rename `clearAll` -> `clear`
  - [ ] Rename `defined()` -> `all()`
  - [ ] Add `has()` and `names()`

- [ ] **kv/kv-helper.ts**:
  - [ ] Rename `$inferValue` -> `inferValue`

- [ ] **schema-helper/schema-helper.ts**:
  - [ ] Convert `createTablesSchemaHelper` to callable
  - [ ] Convert `createKvSchemaHelper` to callable (optional, less critical)
  - [ ] Rename all `$raw` -> `raw`

- [ ] **Update all tests**
- [ ] **Update all call sites** in workspace, lifecycle, actions, etc.
- [ ] **Update README.md** with new API examples

---

## Trade-offs

### Pros

- Zero collision risk between user names and utilities
- No `$` prefix needed anywhere
- More ergonomic than `.get('name')` - just call the function
- Always returns a helper (no undefined checks needed)
- Consistent pattern across all helpers
- TypeScript can still provide full type inference via overloads

### Cons

- Slightly unconventional pattern (callable with properties)
- Breaking change requiring migration
- Function + properties pattern is less common in JS ecosystem

### Why Callable is Better Than `.get()`

| Aspect             | `.get('posts')`                        | `('posts')`                   |
| ------------------ | -------------------------------------- | ----------------------------- |
| Ergonomics         | `tables.get('posts')!.upsert(...)`     | `tables('posts').upsert(...)` |
| Undefined handling | Returns `undefined`, needs `!` or `?.` | Always returns helper         |
| Mental model       | "Get something that might exist"       | "Access this table"           |
| Chaining           | Awkward with `!`                       | Natural                       |

The callable pattern treats tables/kv as **namespaces you index into**, not **collections you query**.
