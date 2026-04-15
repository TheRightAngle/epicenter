# Runtime Schema and Branded Types Patterns

## When to Read This
Read this when defining runtime-validatable schemas or introducing nominal/branded ID types.

# Arktype Optional Properties

## Never Use `| undefined` for Optional Properties

When defining optional properties in arktype schemas, always use the `'key?'` syntax instead of `| undefined` unions. This is critical for JSON Schema conversion (used by OpenAPI/MCP).

### Bad Pattern

```typescript
// DON'T: Explicit undefined union - breaks JSON Schema conversion
const schema = type({
	window_id: 'string | undefined',
	url: 'string | undefined',
});
```

This produces invalid JSON Schema with `anyOf: [{type: "string"}, {}]` because `undefined` has no JSON Schema equivalent.

### Good Pattern

```typescript
// DO: Optional property syntax - converts cleanly to JSON Schema
const schema = type({
	'window_id?': 'string',
	'url?': 'string',
});
```

This correctly omits properties from the `required` array in JSON Schema.

### Why This Matters

| Syntax                       | TypeScript Behavior                        | JSON Schema                     |
| ---------------------------- | ------------------------------------------ | ------------------------------- |
| `key: 'string \| undefined'` | Required prop, accepts string or undefined | Broken (triggers fallback)      |
| `'key?': 'string'`           | Optional prop, accepts string              | Clean (omitted from `required`) |

Both behave similarly in TypeScript, but only the `?` syntax converts correctly to JSON Schema for OpenAPI documentation and MCP tool schemas.

# Branded Types Pattern

## Use Brand Constructors, Never Raw Type Assertions

When working with branded types (nominal typing), always create a brand constructor function. Never use `as BrandedType` assertions scattered throughout the codebase.

### Bad Pattern (Scattered Assertions)

```typescript
// types.ts
type RowId = string & Brand<'RowId'>;

// file1.ts
const id = someString as RowId; // Bad: assertion here

// file2.ts
function getRow(id: string) {
	doSomething(id as RowId); // Bad: another assertion
}

// file3.ts
const parsed = key.split(':')[0] as RowId; // Bad: assertions everywhere
```

### Good Pattern (Brand Constructor)

```typescript
// types.ts
import type { Brand } from 'wellcrafted/brand';

type RowId = string & Brand<'RowId'>;

// Brand constructor - THE ONLY place with `as RowId`
// Uses PascalCase to match the type name (avoids parameter shadowing)
function RowId(id: string): RowId {
	return id as RowId;
}

// file1.ts
const id = RowId(someString); // Good: uses constructor

// file2.ts
function getRow(rowId: string) {
	doSomething(RowId(rowId)); // Good: no shadowing issues
}

// file3.ts
const parsed = RowId(key.split(':')[0]); // Good: consistent
```

### Why Brand Constructors Are Better

1. **Single source of truth**: Only one place has the type assertion
2. **Future validation**: Easy to add runtime validation later
3. **Searchable**: `RowId(` is easy to find and audit
4. **Explicit boundaries**: Clear where unbranded -> branded conversion happens
5. **Refactor-safe**: Change the branding logic in one place
6. **No shadowing**: PascalCase constructor doesn't shadow camelCase parameters

### Implementation Pattern

```typescript
import type { Brand } from 'wellcrafted/brand';

// 1. Define the branded type
export type RowId = string & Brand<'RowId'>;

// 2. Create the brand constructor (only `as` assertion in codebase)
// PascalCase matches the type - TypeScript allows same-name type + value
export function RowId(id: string): RowId {
	return id as RowId;
}

// 3. Optionally add validation
export function RowId(id: string): RowId {
	if (id.includes(':')) {
		throw new Error(`RowId cannot contain ':': ${id}`);
	}
	return id as RowId;
}
```

### Naming Convention

| Branded Type   | Constructor Function |
| -------------- | -------------------- |
| `RowId`        | `RowId()`            |
| `FieldId`      | `FieldId()`          |
| `UserId`       | `UserId()`           |
| `DocumentGuid` | `DocumentGuid()`     |

The constructor uses **PascalCase matching the type name**. TypeScript allows a type and value to share the same name (different namespaces). This avoids parameter shadowing issues.

### When Functions Accept Branded Types

If a function requires a branded type, callers must use the brand constructor:

```typescript
// Function requires branded RowId
function getRow(id: RowId): Row { ... }

// Caller must brand the string - no shadowing since RowId() is PascalCase
function processRow(rowId: string) {
  getRow(RowId(rowId));  // rowId param doesn't shadow RowId() function
}
```

This makes type boundaries visible and intentional, without forcing awkward parameter renames.

### Branded IDs for Workspace Tables

Every `defineTable()` schema MUST use branded ID types for the `id` field and all string foreign keys. Never use plain `'string'` for table IDs.

For tables that use arktype schemas, follow the three-part pattern:

```typescript
// 1. TYPE — extends Id, not string (enables single-cast in generator)
export type SavedTabId = Id & Brand<'SavedTabId'>;

// 2. VALIDATOR — zero-cost type assertion for schema composition
export const SavedTabId = type('string').as<SavedTabId>();

// 3. GENERATOR — wraps generateId() so the cast lives in one place
export const generateSavedTabId = (): SavedTabId =>
	generateId() as SavedTabId;
```

Use directly in the schema: `id: SavedTabId` and for optional FKs: `'parentId?': SavedTabId.or('undefined')`.

At call sites, use the generator—never the double-cast:

```typescript
// Good
const id = generateSavedTabId();

// Bad — scattered casts
const id = generateId() as string as SavedTabId;
```

The `generate*` prefix means "new ID from scratch." The `create*` prefix means "assemble from inputs" (e.g., `createTabCompositeId(deviceId, tabId)`).

Not every branded type needs all three parts. `DeviceId` is set from an external source (no generator). Path types like `AbsolutePath` need only the type.

See the `workspace-api` skill for the full workspace file structure and rules.
