# Minimal Field Schema Refactor

**Created**: 2025-01-07T12:35:00
**Status**: Complete

> **Note (2026-01-08)**: The `json()` field API in this spec uses `CombinedStandardSchema` (arktype/zod). This has been superseded by TypeBox. See `20260108T133200-collaborative-workspace-config-ydoc.handoff.md` Phase 4 for the current API using `Type.Object()` from TypeBox.

## Summary

Refactor field schemas from JSON Schema hybrid format to a minimal, Notion-like format. Remove redundant `type` field, rename `x-component` to `type`, and add table/workspace metadata (emoji, name, description, order).

## Motivation

The current field schema format stores redundant JSON Schema information:

```typescript
// CURRENT: Verbose JSON Schema hybrid
{
  'x-component': 'select',
  type: 'string',  // REDUNDANT - derivable from x-component
  enum: ['draft', 'published'],
}
```

The `type` field is always derivable from `x-component`:

- `'id'` → `'string'`
- `'text'` → `'string'` (or `['string', 'null']` if nullable)
- `'select'` → `'string'` (or `['string', 'null']` if nullable)
- etc.

For user-facing configuration (stored as JSON files in apps/epicenter), this adds noise without value. Users care about "this is a select field with these options", not JSON Schema compliance.

## Design

### New Field Schema Format

Rename `x-component` to `type` (the discriminant). Remove redundant JSON Schema `type` field.

```typescript
// NEW: Minimal, Notion-like
type FieldDefinition =
	| { type: 'id' }
	| { type: 'text'; nullable?: boolean; default?: string }
	| { type: 'richtext' } // always nullable with default null
	| { type: 'integer'; nullable?: boolean; default?: number }
	| { type: 'real'; nullable?: boolean; default?: number }
	| { type: 'boolean'; nullable?: boolean; default?: boolean }
	| { type: 'date'; nullable?: boolean; default?: string }
	| {
			type: 'select';
			options: readonly string[];
			nullable?: boolean;
			default?: string;
	  }
	| {
			type: 'tags';
			options?: readonly string[];
			nullable?: boolean;
			default?: string[];
	  }
	| {
			type: 'json';
			schema: CombinedStandardSchema;
			nullable?: boolean;
			default?: unknown;
	  };
```

### Field Type Definitions

```typescript
// packages/epicenter/src/core/schema/fields/types.ts

export type IdFieldSchema = {
	type: 'id';
};

export type TextFieldSchema<TNullable extends boolean = boolean> = {
	type: 'text';
	nullable?: TNullable;
	default?: string;
};

export type RichtextFieldSchema = {
	type: 'richtext';
	// Always nullable with default null - implicit, no need to store
};

export type IntegerFieldSchema<TNullable extends boolean = boolean> = {
	type: 'integer';
	nullable?: TNullable;
	default?: number;
};

export type RealFieldSchema<TNullable extends boolean = boolean> = {
	type: 'real';
	nullable?: TNullable;
	default?: number;
};

export type BooleanFieldSchema<TNullable extends boolean = boolean> = {
	type: 'boolean';
	nullable?: TNullable;
	default?: boolean;
};

export type DateFieldSchema<TNullable extends boolean = boolean> = {
	type: 'date';
	nullable?: TNullable;
	default?: DateTimeString;
};

export type SelectFieldSchema<
	TOptions extends readonly [string, ...string[]] = readonly [
		string,
		...string[],
	],
	TNullable extends boolean = boolean,
> = {
	type: 'select';
	options: TOptions;
	nullable?: TNullable;
	default?: TOptions[number];
};

export type TagsFieldSchema<
	TOptions extends readonly [string, ...string[]] = readonly [
		string,
		...string[],
	],
	TNullable extends boolean = boolean,
> = {
	type: 'tags';
	options?: TOptions; // Optional: if omitted, any string array allowed
	nullable?: TNullable;
	default?: TOptions[number][];
};

export type JsonFieldSchema<
	TSchema extends CombinedStandardSchema = CombinedStandardSchema,
	TNullable extends boolean = boolean,
> = {
	type: 'json';
	schema: TSchema;
	nullable?: TNullable;
	default?: StandardSchemaV1.InferOutput<TSchema>;
};

export type FieldDefinition =
	| IdFieldSchema
	| TextFieldSchema
	| RichtextFieldSchema
	| IntegerFieldSchema
	| RealFieldSchema
	| BooleanFieldSchema
	| DateFieldSchema
	| SelectFieldSchema
	| TagsFieldSchema
	| JsonFieldSchema;

export type FieldType = FieldDefinition['type'];
```

### Table Definition with Metadata

```typescript
// packages/epicenter/src/core/schema/fields/types.ts

/**
 * Schema for a single field (column) in a table.
 * Must always include an 'id' field with IdFieldSchema.
 */
export type FieldDefinitions = { id: IdFieldSchema } & Record<
	string,
	FieldDefinition
>;

/**
 * Table definition with metadata for UI display.
 */
export type TableDefinition<
	TFields extends FieldDefinitions = FieldDefinitions,
> = {
	/** Display name shown in UI (e.g., "Blog Posts") */
	name: string;
	/** Emoji icon (e.g., "📝") - required for Notion-like UX */
	emoji: string;
	/** Description shown in tooltips/docs */
	description: string;
	/** Explicit ordering for UI (0, 1, 2...) */
	order: number;
	/** The field schemas for this table */
	fields: TFields;
};

/**
 * Tables schema - maps table keys to table definitions.
 */
export type TablesSchema = Record<string, TableDefinition>;

/**
 * @deprecated Use FieldDefinitions instead.
 */
export type TableSchema = FieldDefinitions;
```

### Workspace Schema with Metadata

```typescript
// packages/epicenter/src/core/workspace/contract.ts

export type WorkspaceSchema<
	TId extends string = string,
	TTablesSchema extends TablesSchema = TablesSchema,
	TKvSchema extends KvSchema = KvSchema,
> = {
	/** Globally unique identifier for sync coordination */
	guid: string;
	/** Human-readable slug for URLs, paths, CLI commands */
	id: TId;
	/** Display name shown in UI */
	name: string;
	/** Emoji icon for the workspace */
	emoji: string;
	/** Description of the workspace */
	description: string;
	/** Table definitions */
	tables: TTablesSchema;
	/** Key-value store schema */
	kv: TKvSchema;
};
```

### Factory Functions

```typescript
// packages/epicenter/src/core/schema/fields/factories.ts

export function id(): IdFieldSchema {
	return { type: 'id' };
}

export function text(opts?: {
	nullable?: boolean;
	default?: string;
}): TextFieldSchema {
	return {
		type: 'text',
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && { default: opts.default }),
	};
}

export function richtext(): RichtextFieldSchema {
	return { type: 'richtext' };
}

export function integer(opts?: {
	nullable?: boolean;
	default?: number;
}): IntegerFieldSchema {
	return {
		type: 'integer',
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && { default: opts.default }),
	};
}

export function real(opts?: {
	nullable?: boolean;
	default?: number;
}): RealFieldSchema {
	return {
		type: 'real',
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && { default: opts.default }),
	};
}

export function boolean(opts?: {
	nullable?: boolean;
	default?: boolean;
}): BooleanFieldSchema {
	return {
		type: 'boolean',
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && { default: opts.default }),
	};
}

export function date(opts?: {
	nullable?: boolean;
	default?: Temporal.ZonedDateTime;
}): DateFieldSchema {
	return {
		type: 'date',
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && {
			default: DateTimeString.stringify(opts.default),
		}),
	};
}

export function select<
	const TOptions extends readonly [string, ...string[]],
>(opts: {
	options: TOptions;
	nullable?: boolean;
	default?: TOptions[number];
}): SelectFieldSchema<TOptions> {
	return {
		type: 'select',
		options: opts.options,
		...(opts.nullable && { nullable: true }),
		...(opts.default !== undefined && { default: opts.default }),
	};
}

export function tags<
	const TOptions extends readonly [string, ...string[]],
>(opts?: {
	options?: TOptions;
	nullable?: boolean;
	default?: TOptions[number][];
}): TagsFieldSchema<TOptions> {
	return {
		type: 'tags',
		...(opts?.options && { options: opts.options }),
		...(opts?.nullable && { nullable: true }),
		...(opts?.default !== undefined && { default: opts.default }),
	};
}

export function json<const TSchema extends CombinedStandardSchema>(opts: {
	schema: TSchema;
	nullable?: boolean;
	default?: StandardSchemaV1.InferOutput<TSchema>;
}): JsonFieldSchema<TSchema> {
	return {
		type: 'json',
		schema: opts.schema,
		...(opts.nullable && { nullable: true }),
		...(opts.default !== undefined && { default: opts.default }),
	};
}
```

### Table Definition Helper

````typescript
// packages/epicenter/src/core/schema/fields/factories.ts

/**
 * Helper to define a table with metadata.
 *
 * @example
 * ```typescript
 * const posts = defineTable({
 *   name: 'Posts',
 *   emoji: '📝',
 *   description: 'Blog posts and articles',
 *   order: 0,
 *   fields: {
 *     id: id(),
 *     title: text(),
 *     status: select({ options: ['draft', 'published'] }),
 *   },
 * });
 * ```
 */
export function defineTable<const TFields extends FieldDefinitions>(
	definition: TableDefinition<TFields>,
): TableDefinition<TFields> {
	return definition;
}
````

### Converter Updates

All converters need to switch on `type` instead of `x-component`:

```typescript
// packages/epicenter/src/core/schema/converters/to-arktype.ts

export function fieldDefinitionToArktype<C extends FieldDefinition>(
	fieldDefinition: C,
): FieldDefinitionToArktype<C> {
	let baseType: Type<unknown, {}>;

	switch (
		fieldDefinition.type // Changed from fieldDefinition['x-component']
	) {
		case 'id':
		case 'text':
			baseType = type('string');
			break;
		case 'richtext':
			baseType = type('string');
			break;
		case 'integer':
			baseType = type('number.integer');
			break;
		case 'real':
			baseType = type('number');
			break;
		case 'boolean':
			baseType = type('boolean');
			break;
		case 'date':
			baseType = type('string').narrow(DateTimeString.is);
			break;
		case 'select':
			baseType = type.enumerated(...fieldDefinition.options);
			break;
		case 'tags':
			baseType = fieldDefinition.options
				? type.enumerated(...fieldDefinition.options).array()
				: type('string[]');
			break;
		case 'json':
			baseType = fieldDefinition.schema as unknown as Type<unknown, {}>;
			break;
		default:
			throw new Error(
				`Unknown field type: ${(fieldDefinition as FieldDefinition).type}`,
			);
	}

	// Handle nullability
	const isNullable = isNullableFieldDefinition(fieldDefinition);
	return (
		isNullable ? baseType.or(type('null')) : baseType
	) as FieldDefinitionToArktype<C>;
}
```

### Nullability Helper Update

```typescript
// packages/epicenter/src/core/schema/fields/nullability.ts

export function isNullableFieldDefinition(
	schema: Pick<FieldDefinition, 'type'> & { nullable?: boolean },
): boolean {
	// Richtext is always nullable
	if (schema.type === 'richtext') return true;
	// ID is never nullable
	if (schema.type === 'id') return false;
	// Others check the nullable flag
	return schema.nullable === true;
}
```

### JSON Schema Export (Derived, Not Stored)

```typescript
// packages/epicenter/src/core/schema/converters/to-json-schema.ts

import type { JSONSchema7 } from 'json-schema';

/**
 * Converts a minimal FieldDefinition to JSON Schema.
 * Use this for MCP, OpenAPI, external tool interop.
 */
export function fieldDefinitionToJsonSchema(
	field: FieldDefinition,
): JSONSchema7 {
	const isNullable = isNullableFieldDefinition(field);

	switch (field.type) {
		case 'id':
			return { type: 'string' };

		case 'text':
			return {
				type: isNullable ? ['string', 'null'] : 'string',
				...(field.default !== undefined && { default: field.default }),
			};

		case 'richtext':
			return {
				type: ['string', 'null'],
				default: null,
			};

		case 'integer':
			return {
				type: isNullable ? ['integer', 'null'] : 'integer',
				...(field.default !== undefined && { default: field.default }),
			};

		case 'real':
			return {
				type: isNullable ? ['number', 'null'] : 'number',
				...(field.default !== undefined && { default: field.default }),
			};

		case 'boolean':
			return {
				type: isNullable ? ['boolean', 'null'] : 'boolean',
				...(field.default !== undefined && { default: field.default }),
			};

		case 'date':
			return {
				type: isNullable ? ['string', 'null'] : 'string',
				description:
					'ISO 8601 date with timezone (e.g., 2024-01-01T20:00:00.000Z|America/New_York)',
				pattern: DATE_TIME_STRING_REGEX.source,
				...(field.default !== undefined && { default: field.default }),
			};

		case 'select':
			return {
				type: isNullable ? ['string', 'null'] : 'string',
				enum: [...field.options],
				...(field.default !== undefined && { default: field.default }),
			};

		case 'tags':
			return {
				type: isNullable ? ['array', 'null'] : 'array',
				items: field.options
					? { type: 'string', enum: [...field.options] }
					: { type: 'string' },
				uniqueItems: true,
				...(field.default !== undefined && { default: field.default }),
			};

		case 'json':
			// Use StandardJSONSchema to convert the schema
			const jsonSchema = field.schema['~standard'].jsonSchema.input({
				target: 'draft-07',
			});
			return {
				...(isNullable
					? { oneOf: [jsonSchema, { type: 'null' }] }
					: jsonSchema),
				...(field.default !== undefined && { default: field.default }),
			} as JSONSchema7;

		default:
			throw new Error(`Unknown field type: ${(field as FieldDefinition).type}`);
	}
}
```

## Files to Modify

### Core Schema (packages/epicenter)

| File                                           | Changes                                           |
| ---------------------------------------------- | ------------------------------------------------- |
| `src/core/schema/fields/types.ts`              | Replace all type definitions; add TableDefinition |
| `src/core/schema/fields/factories.ts`          | Update factory functions; add defineTable helper  |
| `src/core/schema/fields/nullability.ts`        | Update to check `type` and `nullable` field       |
| `src/core/schema/converters/to-arktype.ts`     | Switch on `type` instead of `x-component`         |
| `src/core/schema/converters/to-arktype-yjs.ts` | Switch on `type` instead of `x-component`         |
| `src/core/schema/converters/to-typebox.ts`     | Switch on `type` instead of `x-component`         |
| `src/core/schema/converters/to-drizzle.ts`     | Switch on `type` instead of `x-component`         |
| `src/core/schema/index.ts`                     | Update exports                                    |
| `src/core/workspace/contract.ts`               | Add emoji, description to WorkspaceSchema         |

### Epicenter App (apps/epicenter)

| File                                    | Changes                          |
| --------------------------------------- | -------------------------------- |
| `src/lib/services/workspace-storage.ts` | Update WorkspaceFile type        |
| `src/lib/query/workspaces.ts`           | Update field schema construction |

### Examples (examples/content-hub)

| File                                   | Changes                          |
| -------------------------------------- | -------------------------------- |
| `.epicenter/workspaces/*.workspace.ts` | Update all workspace definitions |

## Migration Strategy

### Phase 1: Update Core Types

1. Update `types.ts` with new field schema format
2. Update `factories.ts` with new factory implementations
3. Update `nullability.ts`

### Phase 2: Update Converters

1. Update all converter files to switch on `type`
2. Add new `to-json-schema.ts` for JSON Schema export

### Phase 3: Update Workspace Contract

1. Add required metadata to WorkspaceSchema and TableDefinition
2. Update defineWorkspace function

### Phase 4: Update Consumers

1. Update apps/epicenter workspace storage
2. Update example workspaces

### Phase 5: Testing

1. Run all existing tests
2. Fix any breakages
3. Add tests for new JSON Schema export

## Example: Before and After

### Before (JSON file)

```json
{
	"guid": "abc123",
	"id": "blog",
	"name": "Blog",
	"tables": {
		"posts": {
			"id": { "x-component": "id", "type": "string" },
			"title": { "x-component": "text", "type": "string" },
			"status": {
				"x-component": "select",
				"type": "string",
				"enum": ["draft", "published"]
			}
		}
	},
	"kv": {}
}
```

### After (JSON file)

```json
{
	"guid": "abc123",
	"id": "blog",
	"name": "Blog",
	"emoji": "📝",
	"description": "Personal blog workspace",
	"tables": {
		"posts": {
			"name": "Posts",
			"emoji": "📄",
			"description": "Blog posts and articles",
			"order": 0,
			"fields": {
				"id": { "type": "id" },
				"title": { "type": "text" },
				"status": { "type": "select", "options": ["draft", "published"] }
			}
		}
	},
	"kv": {}
}
```

## Todos

- [x] Update `packages/epicenter/src/core/schema/fields/types.ts`
- [x] Update `packages/epicenter/src/core/schema/fields/factories.ts`
- [x] Update `packages/epicenter/src/core/schema/fields/nullability.ts`
- [x] Update `packages/epicenter/src/core/schema/converters/to-arktype.ts`
- [x] Update `packages/epicenter/src/core/schema/converters/to-arktype-yjs.ts`
- [x] Update `packages/epicenter/src/core/schema/converters/to-typebox.ts`
- [x] Update `packages/epicenter/src/core/schema/converters/to-drizzle.ts`
- [x] Update `packages/epicenter/src/core/schema/index.ts`
- [x] Update `packages/epicenter/src/core/workspace/contract.ts`
- [ ] Add `packages/epicenter/src/core/schema/converters/to-json-schema.ts` (deferred: derive on demand)
- [x] Update `apps/epicenter/src/lib/services/workspace-storage.ts`
- [ ] Update `apps/epicenter/src/lib/query/workspaces.ts` (deferred: uses old format)
- [ ] Update `examples/content-hub/.epicenter/workspaces/*.workspace.ts` (deferred: example workspaces)
- [x] Run tests and fix breakages

## Review

### Summary

Refactored field schemas from JSON Schema hybrid format to a minimal Notion-like format. This is a **breaking change** that removes all deprecated backwards compatibility aliases.

### Changes Made

**Core Type Changes:**

- Discriminant changed from `x-component` to `type`
- Nullability changed from `type: ['string', 'null']` to `nullable?: true` (flag, present only when true)
- Removed redundant JSON Schema `type` field
- Added `TableDefinition` type for table metadata (name, emoji, description, order)

**Type System Fixes:**

- Fixed `IsNullable<C>` helper: changed from `{ nullable: true }` (required) to `{ nullable?: true }` (optional) to correctly handle TypeScript optional property inference
- Fixed `kv-helper.ts`: added `'default' in schema` guard for `RichtextFieldSchema` which has no `default` property

**Breaking Changes (deprecated types removed):**

- Removed `FieldComponent` type alias (use `FieldType`)
- Removed `WorkspaceSchema` type alias in types.ts (use `TablesSchema`)
- Removed `TableSchema` aliases in converter files
- Updated all usages across codebase to use non-deprecated types

**Documentation:**

- Updated `schema/README.md` to describe new minimal format
- Updated `converters/README.md` to remove `x-component` references

### Design Decisions

**Nullable design (`nullable?: true`):**

- Notion doesn't use explicit nullable flags; fields can be empty
- Option B (flag present only when true) chosen for:
  - Minimal JSON storage (no `nullable: false` noise)
  - Clean TypeScript structural checks (`extends { nullable?: true }`)
  - Already implemented this way in factories

**Default values:**

- Kept `default` as optional property
- Notion doesn't expose defaults in API (uses templates instead)
- Epicenter uses defaults for: KV fallbacks, SQLite defaults, JSON Schema export

### Verification

- `bun tsc --noEmit` passes (0 errors)
- `bun test` passes (264 tests, 0 failures)
