/**
 * Shared types for the Workspace API.
 *
 * This module contains all type definitions for versioned tables and KV stores.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonObject } from 'wellcrafted/json';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { Actions } from '../shared/actions.js';
import type { CombinedStandardSchema } from '../shared/standard-schema/types.js';
import type { DocumentContext, Extension, MaybePromise } from './lifecycle.js';

// Re-export JSON types for consumers
export type { JsonObject, JsonValue } from 'wellcrafted/json';

// ════════════════════════════════════════════════════════════════════════════
// TABLE RESULT TYPES - Building Blocks
// ════════════════════════════════════════════════════════════════════════════

/**
 * The minimum shape every versioned table row must satisfy.
 *
 * - `id`: Unique identifier for row lookup and identity
 * - `_v`: Schema version number for tracking which version this row conforms to
 *
 * Intersected with `JsonObject` to ensure all field values are JSON-serializable.
 * This guarantees data stored in Yjs can be safely serialized/deserialized.
 *
 * All table rows extend this base shape. Used as a constraint in generic types
 * to ensure rows have the required fields for versioning and identification.
 */
export type BaseRow = { id: string; _v: number } & JsonObject;

/** A row that passed validation. */
export type ValidRowResult<TRow> = { status: 'valid'; row: TRow };

/** A row that exists but failed validation. */
export type InvalidRowResult = {
	status: 'invalid';
	id: string;
	errors: readonly StandardSchemaV1.Issue[];
	row: unknown;
};

/**
 * A row that was not found.
 * Includes `row: undefined` so row can always be destructured regardless of status.
 */
export type NotFoundResult = {
	status: 'not_found';
	id: string;
	row: undefined;
};

// ════════════════════════════════════════════════════════════════════════════
// TABLE RESULT TYPES - Composed Types
// ════════════════════════════════════════════════════════════════════════════

/**
 * Result of validating a row.
 * The shape after parsing a row from storage - either valid or invalid.
 */
export type RowResult<TRow> = ValidRowResult<TRow> | InvalidRowResult;

/**
 * Result of getting a single row by ID.
 * Includes not_found since the row may not exist.
 */
export type GetResult<TRow> = RowResult<TRow> | NotFoundResult;

/** Result of deleting a single row */
export type DeleteResult =
	| { status: 'deleted' }
	| { status: 'not_found_locally' };

/** Result of updating a single row */
export type UpdateResult<TRow> =
	| { status: 'updated'; row: TRow }
	| NotFoundResult
	| InvalidRowResult;

// ════════════════════════════════════════════════════════════════════════════
// KV RESULT TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Result of getting a KV value */
export type KvGetResult<TValue> =
	| { status: 'valid'; value: TValue }
	| {
			status: 'invalid';
			errors: readonly StandardSchemaV1.Issue[];
			value: unknown;
	  }
	| { status: 'not_found'; value: undefined };

/** Change event for KV observation */
export type KvChange<TValue> =
	| { type: 'set'; value: TValue }
	| { type: 'delete' };

// ════════════════════════════════════════════════════════════════════════════
// TABLE DEFINITION TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Extract the last element from a tuple of schemas. */
export type LastSchema<T extends readonly CombinedStandardSchema[]> =
	T extends readonly [
		...CombinedStandardSchema[],
		infer L extends CombinedStandardSchema,
	]
		? L
		: T[number];

/**
 * A table definition created by `defineTable(schema)` or `defineTable(v1, v2, ...).migrate(fn)`
 *
 * @typeParam TVersions - Tuple of schema versions (each must include `{ id: string }`)
 * @typeParam TDocuments - Record of named document configs declared via `.withDocument()`
 */
export type TableDefinition<
	TVersions extends readonly CombinedStandardSchema<BaseRow>[],
	TDocuments extends Record<string, DocumentConfig> = Record<string, never>,
> = {
	schema: CombinedStandardSchema<
		unknown,
		StandardSchemaV1.InferOutput<TVersions[number]>
	>;
	migrate: (
		row: StandardSchemaV1.InferOutput<TVersions[number]>,
	) => StandardSchemaV1.InferOutput<LastSchema<TVersions>>;
	documents: TDocuments;
};

/** Extract the row type from a TableDefinition */
export type InferTableRow<T> = T extends {
	migrate: (...args: never[]) => infer TLatest;
}
	? TLatest
	: never;

/** Extract the version union type from a TableDefinition */
export type InferTableVersionUnion<T> = T extends {
	schema: CombinedStandardSchema<unknown, infer TOutput>;
}
	? TOutput
	: never;

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENT CONFIG TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * A named document declared via `.withDocument()`.
 *
 * Maps a document concept (e.g., 'content') to a GUID column and an `onUpdate` callback
 * that fires when the content Y.Doc changes:
 * - `guid`: The column storing the Y.Doc GUID (must be a string column)
 * - `onUpdate`: Zero-argument callback returning `Partial<Omit<TRow, 'id'>>` — the fields
 *   to write when the doc changes. Callers control both the value and which columns to update.
 * - `tags`: Optional tag literals for document extension targeting
 *
 * @typeParam TGuid - Literal string type of the guid column name
 * @typeParam TRow - The row type of the table (used to type-check `onUpdate` return)
 * @typeParam TTags - Literal union of tag strings for document extension targeting.
 *   Defaults to `string` so bare `DocumentConfig` works as a wide constraint (accepts any tags).
 *   When `.withDocument()` is called without tags, `TTags` infers as `never` via the
 *   method's own default, which makes the `tags` property `undefined` — preventing
 *   tags on untagged documents.
 */
export type DocumentConfig<
	TGuid extends string = string,
	TRow extends BaseRow = BaseRow,
	TTags extends string = string,
> = {
	guid: TGuid;
	/** Called when the content Y.Doc changes. Return the fields to write to the row. */
	onUpdate: () => Partial<Omit<TRow, 'id'>>;
	/**
	 * Tag literals for document extension targeting.
	 *
	 * Always present — defaults to `[]` when no tags are declared.
	 *
	 * - `TTags = never` (no tags on document) → `readonly never[]` (only accepts `[]`)
	 * - `TTags = 'persistent' | 'synced'` → `readonly ('persistent' | 'synced')[]`
	 * - `TTags = string` (bare `DocumentConfig`) → `readonly string[]`
	 */
	tags: readonly TTags[];
};

/**
 * Internal registration for a document extension.
 *
 * Stored in an array by `withDocumentExtension()`. Each entry contains
 * the extension key, factory function, and optional tag filter.
 *
 * At document open time, the runtime iterates registrations and fires
 * factories whose tags match (set intersection) or have no tags (universal).
 */
export type DocumentExtensionRegistration = {
	key: string;
	factory: (context: DocumentContext) =>
		| (Record<string, unknown> & {
				whenReady?: Promise<unknown>;
				destroy?: () => MaybePromise<void>;
		  })
		| void;
	tags: readonly string[];
};

/**
 * Extract all tags across all tables' document configs.
 *
 * Collects all tag literal types from all table definitions into a union
 * for type-safe autocomplete in `withDocumentExtension({ tags: [...] })`.
 *
 * @example
 * ```typescript
 * // Given tables with tags ['persistent', 'synced'] and ['ephemeral']:
 * type Tags = ExtractAllDocumentTags<typeof tables>;
 * // => 'persistent' | 'synced' | 'ephemeral'
 * ```
 */
export type ExtractAllDocumentTags<TTableDefs extends TableDefinitions> = {
	[K in keyof TTableDefs]: TTableDefs[K] extends {
		documents: Record<string, DocumentConfig<string, BaseRow, infer TTags>>;
	}
		? TTags
		: never;
}[keyof TTableDefs];

/**
 * Extract keys of `TRow` whose value type extends `string`.
 * Used to constrain the `guid` parameter of `.withDocument()`.
 */
export type StringKeysOf<TRow> = {
	[K in keyof TRow & string]: TRow[K] extends string ? K : never;
}[keyof TRow & string];

/**
 * Collect all column names already claimed as `guid` by prior `.withDocument()` calls.
 * Subsequent calls cannot reuse these columns, preventing two documents from sharing
 * a GUID (which would cause storage collisions).
 *
 * With the `onUpdate` callback model, updatedAt columns are no longer claimed —
 * multiple documents can write to the same column via their callbacks (last write wins).
 *
 * Requires `{}` (not `Record<string, never>`) as the initial empty `TDocuments`,
 * so that `keyof {}` = `never` and the union resolves cleanly.
 */
export type ClaimedDocumentColumns<
	TDocuments extends Record<string, DocumentConfig>,
> = TDocuments[keyof TDocuments]['guid'];

/**
 * A handle to an open content Y.Doc, returned by `documents.open()`.
 *
 * All operations are scoped to this specific document. Content methods
 * (read, write) are synchronous because the Y.Doc is already open.
 * Exports are a property, not a function, because they belong to this doc.
 */
export type DocumentHandle = {
	/** The raw Y.Doc — escape hatch for custom operations (timelines, binary, sheets). */
	ydoc: Y.Doc;

	/** Read the document's text content (from `ydoc.getText('content')`). */
	read(): string;

	/** Replace the document's text content. */
	write(text: string): void;

	/**
	 * Per-doc extension exports, keyed by extension name.
	 *
	 * Each key corresponds to a document extension registered via
	 * `withDocumentExtension()`. The value is that extension's `exports` object.
	 *
	 * @example
	 * ```typescript
	 * const handle = await documents.open(guid);
	 * await handle.exports.persistence?.clearData?.();
	 * ```
	 */
	exports: Record<string, Record<string, unknown>>;
};

/**
 * Runtime manager for a table's associated content Y.Docs.
 *
 * Manages Y.Doc creation, provider lifecycle, `updatedAt` auto-bumping,
 * and cleanup on row deletion. Most users access this via
 * `client.documents.files.content`.
 *
 * @typeParam TRow - The row type of the bound table
 *
 * @example
 * ```typescript
 * const handle = await documents.open(row);
 * handle.ydoc.getText('body').insert(0, 'hello');
 * // updatedAt on the row is bumped automatically
 *
 * const text = handle.read();
 * handle.write('new content');
 * await documents.close(row);
 * ```
 */
export type Documents<TRow extends BaseRow> = {
	/**
	 * Open a content Y.Doc for a row.
	 *
	 * Creates the Y.Doc if it doesn't exist, wires up providers, and attaches
	 * the updatedAt observer. Idempotent — calling open() twice for the same
	 * row returns the same handle (same Y.Doc).
	 *
	 * @param input - A row (extracts GUID from the bound column) or a GUID string
	 */
	open(input: TRow | string): Promise<DocumentHandle>;

	/**
	 * Close a document — free memory, disconnect providers.
	 * Persisted data is NOT deleted. The doc can be re-opened later.
	 *
	 * @param input - A row or GUID string
	 */
	close(input: TRow | string): Promise<void>;

	/**
	 * Close all open documents. Called automatically by workspace destroy().
	 */
	closeAll(): Promise<void>;
};

/**
 * Does this table definition have a non-empty `documents` record?
 *
 * Used by `DocumentsHelper` to filter the `documents` namespace — only tables
 * with `.withDocument()` declarations appear in `client.documents`.
 */
export type HasDocuments<T> = T extends { documents: infer TDocuments }
	? keyof TDocuments extends never
		? false
		: true
	: false;

/**
 * Extract the document map for a single table definition.
 *
 * Maps each doc name to a `Documents<TLatest>` where `TLatest` is the
 * table's latest row type (inferred from the `migrate` function's return type).
 */
export type DocumentsOf<T> = T extends {
	documents: infer TDocuments;
	migrate: (...args: never[]) => infer TLatest;
}
	? TLatest extends BaseRow
		? { [K in keyof TDocuments]: Documents<TLatest> }
		: never
	: never;

/**
 * Top-level document namespace — parallel to `TablesHelper`.
 *
 * Only includes tables that have document configs declared via `.withDocument()`.
 * Tables without documents are filtered out via key remapping.
 *
 * @example
 * ```typescript
 * // Table with .withDocument('content', ...)
 * client.documents.files.content.open(row)
 *
 * // Table without .withDocument() — TypeScript error
 * client.documents.tags // Property 'tags' does not exist
 * ```
 */
export type DocumentsHelper<TTableDefinitions extends TableDefinitions> = {
	[K in keyof TTableDefinitions as HasDocuments<
		TTableDefinitions[K]
	> extends true
		? K
		: never]: DocumentsOf<TTableDefinitions[K]>;
};

// ════════════════════════════════════════════════════════════════════════════
// KV DEFINITION TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * A KV definition created by `defineKv(schema)` or `defineKv(v1, v2, ...).migrate(fn)`
 *
 * @typeParam TVersions - Tuple of schema versions
 */
export type KvDefinition<TVersions extends readonly CombinedStandardSchema[]> =
	{
		schema: CombinedStandardSchema<
			unknown,
			StandardSchemaV1.InferOutput<TVersions[number]>
		>;
		migrate: (
			value: StandardSchemaV1.InferOutput<TVersions[number]>,
		) => StandardSchemaV1.InferOutput<LastSchema<TVersions>>;
	};

/** Extract the value type from a KvDefinition */
export type InferKvValue<T> =
	T extends KvDefinition<infer V>
		? StandardSchemaV1.InferOutput<LastSchema<V>>
		: never;

/** Extract the version union type from a KvDefinition */
export type InferKvVersionUnion<T> =
	T extends KvDefinition<infer V>
		? StandardSchemaV1.InferOutput<V[number]>
		: never;

// ════════════════════════════════════════════════════════════════════════════
// HELPER TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Type-safe table helper for a single workspace table.
 *
 * Provides CRUD operations with schema validation and migration on read.
 * Backed by a YKeyValueLww store with row-level atomicity — `set()` replaces
 * the entire row, and partial updates are done via read-merge-write.
 *
 * ## Row Type
 *
 * `TRow` always extends `{ id: string }` and represents the latest schema
 * version's output type. Old rows are migrated to the latest schema on read.
 *
 * Uses row-level replacement (`set`). Batching is done at the workspace level
 * via `client.batch()`, which wraps `ydoc.transact()`.
 *
 * @typeParam TRow - The fully-typed row shape for this table (extends `{ id: string }`)
 */
export type TableHelper<TRow extends BaseRow> = {
	// ═══════════════════════════════════════════════════════════════════════
	// PARSE
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Parse unknown input against the table schema and migrate to the latest version.
	 *
	 * Injects `id` into the input before validation. Does not write to storage.
	 * Useful for validating external data (imports, API payloads) before committing.
	 *
	 * @param id - The row ID to inject into the input
	 * @param input - Unknown data to validate against the table schema
	 * @returns `{ status: 'valid', row }` or `{ status: 'invalid', id, errors, row }`
	 */
	parse(id: string, input: unknown): RowResult<TRow>;

	// ═══════════════════════════════════════════════════════════════════════
	// WRITE (always writes latest schema shape)
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Set a row (insert or replace). Always writes the full row.
	 *
	 * This is row-level atomic — the entire row is replaced in storage.
	 * There is no runtime validation on write; TypeScript enforces the shape.
	 *
	 * @param row - The complete row to write (must include `id`)
	 */
	set(row: TRow): void;

	// ═══════════════════════════════════════════════════════════════════════
	// READ (validates + migrates to latest)
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Get a single row by ID.
	 *
	 * Returns a discriminated union:
	 * - `{ status: 'valid', row }` — Row exists and passes schema validation
	 * - `{ status: 'invalid', id, errors, row }` — Row exists but fails validation
	 * - `{ status: 'not_found', id, row: undefined }` — Row doesn't exist
	 *
	 * Old data is migrated to the latest schema version on read.
	 *
	 * @param id - The row ID to look up
	 */
	get(id: string): GetResult<TRow>;

	/**
	 * Get all rows with their validation status.
	 *
	 * Each result is either `{ status: 'valid', row }` or
	 * `{ status: 'invalid', id, errors, row }`. Old data is migrated on read.
	 */
	getAll(): RowResult<TRow>[];

	/**
	 * Get all rows that pass schema validation.
	 *
	 * Invalid rows are silently skipped. Use `getAllInvalid()` to inspect them.
	 */
	getAllValid(): TRow[];

	/**
	 * Get all rows that fail schema validation.
	 *
	 * Useful for debugging data corruption, schema drift, or incomplete migrations.
	 * Returns the raw row data alongside validation errors.
	 */
	getAllInvalid(): InvalidRowResult[];

	// ═══════════════════════════════════════════════════════════════════════
	// QUERY
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Filter valid rows by predicate.
	 *
	 * Invalid rows are silently skipped (never passed to the predicate).
	 *
	 * @param predicate - Function that returns `true` for rows to include
	 * @returns Array of matching valid rows
	 */
	filter(predicate: (row: TRow) => boolean): TRow[];

	/**
	 * Find the first valid row matching a predicate.
	 *
	 * Invalid rows are silently skipped. Returns `undefined` if no match found.
	 *
	 * @param predicate - Function that returns `true` for the desired row
	 * @returns The first matching valid row, or `undefined`
	 */
	find(predicate: (row: TRow) => boolean): TRow | undefined;

	// ═══════════════════════════════════════════════════════════════════════
	// UPDATE
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Partial update a row by ID.
	 *
	 * Reads the current row, merges the partial fields, validates the merged
	 * result, and writes it back. Returns the updated row on success.
	 *
	 * @param id - The row ID to update
	 * @param partial - Fields to merge (all fields except `id` are optional)
	 * @returns `{ status: 'updated', row }`, or not_found/invalid if the merge fails
	 */
	update(id: string, partial: Partial<Omit<TRow, 'id'>>): UpdateResult<TRow>;

	// ═══════════════════════════════════════════════════════════════════════
	// DELETE
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Delete a single row by ID.
	 *
	 * If the row doesn't exist locally, returns `{ status: 'not_found_locally' }`.
	 *
	 * @param id - The row ID to delete
	 */
	delete(id: string): DeleteResult;

	/**
	 * Delete all rows from the table.
	 *
	 * The table structure is preserved — observers remain attached and the
	 * table helper continues to work after clearing. Only row data is removed.
	 */
	clear(): void;

	// ═══════════════════════════════════════════════════════════════════════
	// OBSERVE
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Watch for row changes.
	 *
	 * The callback receives a `Set<string>` of row IDs that changed. To
	 * determine what happened, call `table.get(id)`:
	 * - `status === 'not_found'` → the row was deleted
	 * - Otherwise → the row was added or updated
	 *
	 * Changes are batched per Y.Transaction.
	 *
	 * @param callback - Receives changed IDs and the Y.Transaction
	 * @returns Unsubscribe function
	 */
	observe(
		callback: (changedIds: Set<string>, transaction: unknown) => void,
	): () => void;

	// ═══════════════════════════════════════════════════════════════════════
	// METADATA
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Get the total number of rows in the table.
	 *
	 * Includes both valid and invalid rows.
	 */
	count(): number;

	/**
	 * Check if a row exists by ID.
	 *
	 * @param id - The row ID to check
	 */
	has(id: string): boolean;
};

// ════════════════════════════════════════════════════════════════════════════
// AWARENESS TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Map of awareness field definitions. Each field has its own CombinedStandardSchema schema. */
export type AwarenessDefinitions = Record<string, CombinedStandardSchema>;

/** Extract the output type of an awareness field's schema. */
export type InferAwarenessValue<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<T>
	: never;

/**
 * The composed state type — all fields optional since peers may not have set every field.
 *
 * Each field's type is inferred from its StandardSchemaV1 schema. Fields are optional
 * because awareness is inherently partial — peers publish what they have.
 */
export type AwarenessState<TDefs extends AwarenessDefinitions> = {
	[K in keyof TDefs]?: InferAwarenessValue<TDefs[K]>;
};

/**
 * Helper for typed awareness access.
 * Wraps the raw y-protocols Awareness instance with schema-validated methods.
 *
 * Uses the record-of-fields pattern (same as tables and KV). Each field has its own
 * StandardSchemaV1 schema. When no fields are defined, `AwarenessHelper<Record<string, never>>`
 * has zero accessible field keys — methods exist but accept no valid arguments.
 *
 * @typeParam TDefs - Record of awareness field definitions (field name → StandardSchemaV1)
 */
export type AwarenessHelper<TDefs extends AwarenessDefinitions> = {
	/**
	 * Set this client's awareness state (merge into current state).
	 * Broadcasts to all connected peers via the awareness protocol.
	 * Accepts partial — only specified fields are set (merged into current state).
	 * No runtime validation — TypeScript catches type errors at compile time.
	 */
	setLocal(state: AwarenessState<TDefs>): void;

	/**
	 * Set a single awareness field.
	 * Maps directly to y-protocols setLocalStateField().
	 *
	 * @param key - The field name to set
	 * @param value - The value for the field (type-checked against the field's schema)
	 */
	setLocalField<K extends keyof TDefs & string>(
		key: K,
		value: InferAwarenessValue<TDefs[K]>,
	): void;

	/**
	 * Get this client's current awareness state.
	 * Returns null if not yet set.
	 */
	getLocal(): AwarenessState<TDefs> | null;

	/**
	 * Get a single local awareness field.
	 * Returns undefined if not set.
	 *
	 * @param key - The field name to get
	 * @returns The field value, or undefined if not set
	 */
	getLocalField<K extends keyof TDefs & string>(
		key: K,
	): InferAwarenessValue<TDefs[K]> | undefined;

	/**
	 * Get all connected clients' awareness states.
	 * Returns Map from Yjs clientID to validated state.
	 * Each field is independently validated against its schema.
	 * Invalid fields are omitted from the result (valid fields still included).
	 * Clients with zero valid fields are excluded entirely.
	 */
	getAll(): Map<number, AwarenessState<TDefs>>;

	/**
	 * Watch for awareness changes.
	 * Callback receives a map of clientIDs to change type.
	 * Returns unsubscribe function.
	 */
	observe(
		callback: (changes: Map<number, 'added' | 'updated' | 'removed'>) => void,
	): () => void;

	/**
	 * The raw y-protocols Awareness instance.
	 * Escape hatch for advanced use (custom heartbeats, direct protocol access).
	 * Pass to sync providers: createYjsProvider(ydoc, ..., { awareness: ctx.awareness.raw })
	 */
	raw: Awareness;
};

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Map of table definitions (uses `any` to allow variance in generic parameters) */
export type TableDefinitions = Record<
	string,
	// biome-ignore lint/suspicious/noExplicitAny: variance-friendly map type
	TableDefinition<any, any>
>;

/** Map of KV definitions (uses `any` to allow variance in generic parameters) */
export type KvDefinitions = Record<
	string,
	// biome-ignore lint/suspicious/noExplicitAny: variance-friendly map type
	KvDefinition<any>
>;

/**
 * Tables helper — pure CRUD, no document management.
 *
 * Document managers live in the separate `documents` namespace on the client.
 * This type is a plain mapped type over table definitions.
 */
export type TablesHelper<TTableDefinitions extends TableDefinitions> = {
	[K in keyof TTableDefinitions]: TableHelper<
		InferTableRow<TTableDefinitions[K]>
	>;
};

/** KV helper with dictionary-style access */
export type KvHelper<TKvDefinitions extends KvDefinitions> = {
	/** Get a value by key (validates + migrates). */
	get<K extends keyof TKvDefinitions & string>(
		key: K,
	): KvGetResult<InferKvValue<TKvDefinitions[K]>>;

	/** Set a value by key (always latest schema). */
	set<K extends keyof TKvDefinitions & string>(
		key: K,
		value: InferKvValue<TKvDefinitions[K]>,
	): void;

	/** Delete a value by key. */
	delete<K extends keyof TKvDefinitions & string>(key: K): void;

	/** Watch for changes to a key. Returns unsubscribe function. */
	observe<K extends keyof TKvDefinitions & string>(
		key: K,
		callback: (
			change: KvChange<InferKvValue<TKvDefinitions[K]>>,
			transaction: unknown,
		) => void,
	): () => void;
};

/**
 * Workspace definition created by defineWorkspace().
 *
 * This is a pure data structure for composability and type inference.
 * Pass to createWorkspace() to instantiate.
 */
export type WorkspaceDefinition<
	TId extends string,
	TTableDefinitions extends TableDefinitions = Record<string, never>,
	TKvDefinitions extends KvDefinitions = Record<string, never>,
	TAwarenessDefinitions extends AwarenessDefinitions = Record<string, never>,
> = {
	id: TId;
	tables?: TTableDefinitions;
	kv?: TKvDefinitions;
	/** Record of awareness field schemas. Each field has its own StandardSchemaV1 schema. */
	awareness?: TAwarenessDefinitions;
};

/**
 * A workspace client with actions attached via `.withActions()`.
 *
 * This is an intersection of the base `WorkspaceClient` and `{ actions: TActions }`.
 * It is terminal — no more builder methods are available after `.withActions()`.
 */
export type WorkspaceClientWithActions<
	TId extends string,
	TTableDefs extends TableDefinitions,
	TKvDefs extends KvDefinitions,
	TAwarenessDefinitions extends AwarenessDefinitions,
	TExtensions extends Record<string, unknown>,
	TActions extends Actions,
> = WorkspaceClient<
	TId,
	TTableDefs,
	TKvDefs,
	TAwarenessDefinitions,
	TExtensions
> & {
	actions: TActions;
};

/**
 * Builder returned by `createWorkspace()` and by each `.withExtension()` call.
 *
 * IS a usable client AND has `.withExtension()` + `.withActions()`.
 *
 * ## Why `.withExtension()` is chainable (not a map)
 *
 * Extensions use chainable `.withExtension(key, factory)` calls instead of a single
 * `.withActions({...})` map for a key reason: **extensions build on each other progressively**.
 *
 * Each `.withExtension()` call returns a new builder where the next extension's factory
 * receives the accumulated extensions-so-far as typed context. This means extension N+1
 * can access extension N's exports. You may also be importing extensions you don't fully
 * control, and chaining lets you compose on top of them without modifying their source.
 *
 * Actions, by contrast, use a single `.withActions(factory)` call because:
 * - Actions are always defined by the app author (not imported from external packages)
 * - Actions don't build on each other — they all receive the same finalized client
 * - The ergonomic benefit of declaring all actions in one place outweighs chaining
 *
 * @example
 * ```typescript
 * const client = createWorkspace(definition)
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withExtension('sync', ySweetSync({ auth: directAuth('...') }))
 *   .withActions((client) => ({
 *     createPost: defineMutation({ ... }),
 *   }));
 * ```
 */
export type WorkspaceClientBuilder<
	TId extends string,
	TTableDefinitions extends TableDefinitions,
	TKvDefinitions extends KvDefinitions,
	TAwarenessDefinitions extends AwarenessDefinitions,
	TExtensions extends Record<string, unknown> = Record<string, never>,
	TDocExtensions extends Record<string, unknown> = Record<string, never>,
> = WorkspaceClient<
	TId,
	TTableDefinitions,
	TKvDefinitions,
	TAwarenessDefinitions,
	TExtensions
> & {
	/**
	 * Add a single extension. Returns a new builder with the extension's
	 * exports accumulated into the extensions type.
	 *
	 * Extensions are chained because they can build on each other progressively —
	 * each factory receives the client-so-far (including all previously added extensions)
	 * as typed context. This enables extension N+1 to access extension N's exports.
	 *
	 * The factory returns a flat object with custom exports + optional `whenReady`
	 * and `destroy`. The framework normalizes defaults via `defineExtension()`.
	 *
	 * @param key - Unique name for this extension (used as the key in `.extensions`)
	 * @param factory - Factory receiving the client-so-far context, returns flat exports
	 * @returns A new builder with the extension's exports added to the type
	 *
	 * @example
	 * ```typescript
	 * const client = createWorkspace(definition)
	 *   .withExtension('persistence', ({ ydoc }) => {
	 *     const idb = new IndexeddbPersistence(ydoc.guid, ydoc);
	 *     return { clearData: () => idb.clearData(), whenReady: idb.whenSynced, destroy: () => idb.destroy() };
	 *   })
	 *   .withExtension('sync', ({ extensions, whenReady }) => {
	 *     // extensions.persistence is fully typed here!
	 *     // whenReady waits for all prior extensions
	 *     return { provider, whenReady: syncReady, destroy: () => provider.destroy() };
	 *   });
	 * ```
	 */
	withExtension<TKey extends string, TExports extends Record<string, unknown>>(
		key: TKey,
		factory: (
			context: ExtensionContext<
				TId,
				TTableDefinitions,
				TKvDefinitions,
				TAwarenessDefinitions,
				TExtensions
			>,
		) => TExports & {
			whenReady?: Promise<unknown>;
			destroy?: () => MaybePromise<void>;
		},
	): WorkspaceClientBuilder<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions,
		TExtensions &
			Record<TKey, Extension<Omit<TExports, 'whenReady' | 'destroy'>>>,
		TDocExtensions
	>;

	/**
	 * Register a document extension that fires when content Y.Docs are opened
	 * via a table's documents manager.
	 *
	 * Document extensions are separate from workspace extensions — they operate on
	 * content Y.Docs (not the workspace Y.Doc). Use optional `{ tags }` to target
	 * specific document types declared via `withDocument(..., { tags })`.
	 *
	 * If no `tags` option is provided, the extension is universal (fires for all content documents).
	 * If `tags` is provided, the extension fires only for documents whose tags share at
	 * least one value with the extension's tags (set intersection).
	 *
	 * @param key - Unique name for this document extension (independent namespace from workspace extensions)
	 * @param factory - Factory function receiving DocumentContext, returns Extension or void
	 * @param options - Optional tag filter for targeting specific document types
	 * @returns A new builder with the document extension key accumulated
	 *
	 * @example
	 * ```typescript
	 * createWorkspace({ id: 'app', tables: { notes } })
	 *   .withExtension('persistence', workspacePersistence)
	 *   .withDocumentExtension('persistence', indexeddbPersistence, { tags: ['persistent'] })
	 * ```
	 */
	withDocumentExtension<
		K extends string,
		TDocExports extends Record<string, unknown>,
	>(
		key: K,
		factory: (context: DocumentContext<TDocExtensions>) =>
			| (TDocExports & {
					whenReady?: Promise<unknown>;
					destroy?: () => MaybePromise<void>;
			  })
			| void,
		options?: { tags?: ExtractAllDocumentTags<TTableDefinitions>[] },
	): WorkspaceClientBuilder<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions,
		TExtensions,
		TDocExtensions & Record<K, Omit<TDocExports, 'whenReady' | 'destroy'>>
	>;

	/**
	 * Attach actions to the workspace client. Terminal — no more chaining after this.
	 *
	 * Actions use a single map (not chaining) because they don't build on each other
	 * and are always defined by the app author. The ergonomic benefit of declaring
	 * all actions in one place outweighs the progressive composition that extensions need.
	 *
	 * @param factory - Receives the finalized client, returns an actions map
	 * @returns Client with actions attached (no more builder methods)
	 */
	withActions<TActions extends Actions>(
		factory: (
			client: WorkspaceClient<
				TId,
				TTableDefinitions,
				TKvDefinitions,
				TAwarenessDefinitions,
				TExtensions
			>,
		) => TActions,
	): WorkspaceClientWithActions<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions,
		TExtensions,
		TActions
	>;
};

// Re-export Extension for convenience
export type { Extension } from './lifecycle.js';

// ════════════════════════════════════════════════════════════════════════════
// EXTENSION TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Context passed to workspace extension factories.
 *
 * This is a `WorkspaceClient` minus `destroy` and `[Symbol.asyncDispose]` —
 * extension factories receive the full client surface but don't control
 * the workspace's lifecycle. They return their own lifecycle hooks instead.
 *
 * ```typescript
 * .withExtension('persistence', ({ ydoc }) => { ... })
 * .withExtension('sync', ({ ydoc, awareness, whenReady }) => { ... })
 * .withExtension('sqlite', ({ id, tables }) => { ... })
 * ```
 *
 * `whenReady` is the composite promise from all PRIOR extensions — use it to
 * sequence initialization (e.g., wait for persistence before connecting sync).
 *
 * `extensions` provides typed access to prior extensions' exports.
 */
export type ExtensionContext<
	TId extends string = string,
	TTableDefinitions extends TableDefinitions = TableDefinitions,
	TKvDefinitions extends KvDefinitions = KvDefinitions,
	TAwarenessDefinitions extends AwarenessDefinitions = AwarenessDefinitions,
	TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = Omit<
	WorkspaceClient<
		TId,
		TTableDefinitions,
		TKvDefinitions,
		TAwarenessDefinitions,
		TExtensions
	>,
	'destroy' | typeof Symbol.asyncDispose
>;

/**
 * Factory function that creates an extension.
 *
 * Returns a flat object with custom exports + optional `whenReady` and `destroy`.
 * The framework normalizes defaults via `defineExtension()`.
 *
 * @example Simple extension (works with any workspace)
 * ```typescript
 * const persistence: ExtensionFactory = ({ ydoc }) => {
 *   const provider = new IndexeddbPersistence(ydoc.guid, ydoc);
 *   return {
 *     provider,
 *     whenReady: provider.whenReady,
 *     destroy: () => provider.destroy(),
 *   };
 * };
 * ```
 *
 * @typeParam TExports - The consumer-facing exports object type
 */
export type ExtensionFactory<
	TExports extends Record<string, unknown> = Record<string, unknown>,
> = (context: ExtensionContext) => TExports & {
	whenReady?: Promise<unknown>;
	destroy?: () => MaybePromise<void>;
};

/** The workspace client returned by createWorkspace() */
export type WorkspaceClient<
	TId extends string,
	TTableDefinitions extends TableDefinitions,
	TKvDefinitions extends KvDefinitions,
	TAwarenessDefinitions extends AwarenessDefinitions,
	TExtensions extends Record<string, unknown>,
> = {
	/** Workspace identifier */
	id: TId;
	/** The underlying Y.Doc instance */
	ydoc: Y.Doc;
	/** Workspace definitions for introspection */
	definitions: {
		tables: TTableDefinitions;
		kv: TKvDefinitions;
		awareness: TAwarenessDefinitions;
	};
	/** Typed table helpers — pure CRUD, no document management */
	tables: TablesHelper<TTableDefinitions>;
	/** Document managers — only tables with `.withDocument()` appear here */
	documents: DocumentsHelper<TTableDefinitions>;
	/** Typed KV helper */
	kv: KvHelper<TKvDefinitions>;
	/** Typed awareness helper — always present, like tables and kv */
	awareness: AwarenessHelper<TAwarenessDefinitions>;
	/**
	 * Extension exports (accumulated via `.withExtension()` calls).
	 *
	 * Each entry is the exports object returned by the extension factory.
	 * Access exports directly — no wrapper:
	 *
	 * ```typescript
	 * client.extensions.persistence.clearData();
	 * client.extensions.sqlite.db.query('SELECT ...');
	 * ```
	 *
	 * Use `client.whenReady` to wait for all extensions to initialize.
	 */
	extensions: TExtensions;

	/**
	 * Execute multiple operations atomically in a single Y.js transaction.
	 *
	 * Groups all table and KV mutations inside the callback into one transaction.
	 * This means:
	 * - Observers fire once (not per-operation)
	 * - Creates a single undo/redo step
	 * - All changes are applied together
	 *
	 * The callback receives nothing because `tables` and `kv` are the same objects
	 * whether you're inside `batch()` or not — `ydoc.transact()` makes ALL operations
	 * on the shared doc atomic automatically. No special transactional wrapper needed.
	 *
	 * **Note**: Yjs transactions do NOT roll back on error. If the callback throws,
	 * any mutations that already executed within the callback are still applied.
	 *
	 * Nested `batch()` calls are safe — Yjs transact is reentrant, so inner calls
	 * are absorbed by the outer transaction.
	 *
	 * @param fn - Callback containing table/KV operations to batch
	 *
	 * @example Single table batching
	 * ```typescript
	 * client.batch(() => {
	 *   client.tables.posts.set({ id: '1', title: 'First' });
	 *   client.tables.posts.set({ id: '2', title: 'Second' });
	 *   client.tables.posts.delete('3');
	 * });
	 * // Observer fires once with all 3 changed IDs
	 * ```
	 *
	 * @example Cross-table + KV batching
	 * ```typescript
	 * client.batch(() => {
	 *   client.tables.tabs.set({ id: '1', url: 'https://...' });
	 *   client.tables.windows.set({ id: 'w1', name: 'Main' });
	 *   client.kv.set('lastSync', new Date().toISOString());
	 * });
	 * // All three writes are one atomic transaction
	 * ```
	 *
	 */
	batch(fn: () => void): void;

	/** Promise resolving when all extensions are ready */
	whenReady: Promise<void>;

	/** Cleanup all resources */
	destroy(): Promise<void>;

	/** Async dispose support */
	[Symbol.asyncDispose](): Promise<void>;
};

/**
 * Type alias for any workspace client (used for duck-typing in CLI/server).
 *
 * Uses `WorkspaceClient & { actions?: Actions }` rather than `WorkspaceClientWithActions`
 * because `WorkspaceClientWithActions` requires `actions: TActions` (non-optional) —
 * it can't express "might or might not have actions."
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional variance-friendly type
export type AnyWorkspaceClient = WorkspaceClient<any, any, any, any, any> & {
	actions?: Actions;
};
