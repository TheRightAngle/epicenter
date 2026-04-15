/**
 * Generate SQLite DDL from workspace JSON Schema descriptors.
 *
 * The SQLite materializer only needs the latest materialized row shape. When a table
 * schema has multiple versions, this module picks the highest `_v` variant and
 * generates a `CREATE TABLE IF NOT EXISTS` statement that preserves the exact
 * workspace field names.
 *
 * Complex values like arrays and objects are stored as JSON-serialized `TEXT`
 * columns because the materializer is a read cache, not the source-of-truth schema.
 *
 * @module
 */

type JsonSchema = Record<string, unknown>;

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate a `CREATE TABLE IF NOT EXISTS` statement for a workspace table.
 *
 * This mirrors the JSON Schema shape exposed by `describeWorkspace()` into a
 * SQLite table definition. Required scalar fields become `NOT NULL`, `id`
 * becomes the primary key, version discriminants use `INTEGER NOT NULL`, and
 * complex values are stored as JSON text.
 *
 * @param tableName - The SQLite table name to create
 * @param jsonSchema - The JSON Schema from `describeWorkspace().tables[name].schema`
 * @returns A `CREATE TABLE IF NOT EXISTS` SQL statement
 *
 * @example
 * ```typescript
 * const sql = generateDdl('posts', {
 *   type: 'object',
 *   properties: {
 *     id: { type: 'string' },
 *     _v: { const: 2 },
 *     title: { type: 'string' },
 *     published: { type: 'boolean' },
 *   },
 *   required: ['id', '_v', 'title'],
 * });
 *
 * // CREATE TABLE IF NOT EXISTS "posts" ("id" TEXT PRIMARY KEY, "_v" INTEGER NOT NULL, "title" TEXT NOT NULL, "published" INTEGER)
 * ```
 */
export function generateDdl(
	tableName: string,
	jsonSchema: Record<string, unknown>,
): string {
	const resolved = resolveSchema(jsonSchema);

	if (!isRecord(resolved.properties)) {
		throw new Error(
			'SQLite DDL generation requires an object schema with properties.',
		);
	}

	const properties = resolved.properties;
	const required = new Set(
		Array.isArray(resolved.required)
			? (resolved.required as unknown[]).filter(
					(value): value is string => typeof value === 'string',
				)
			: [],
	);

	const columns = Object.entries(properties).map(([name, propSchema]) => {
		if (!isRecord(propSchema)) {
			throw new Error(
				`SQLite DDL generation requires property "${name}" schema to be an object.`,
			);
		}
		return columnDef(name, propSchema, required.has(name));
	});

	return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (${columns.join(', ')})`;
}

/**
 * Resolve the concrete schema variant used for SQLite DDL generation.
 *
 * Multi-version workspace tables expose a `oneOf` where each entry represents a
 * versioned row shape. The workspace read path migrates rows to the latest
 * version before materialization, so the SQLite materializer should generate columns
 * from the schema whose `_v.const` is highest.
 *
 * If the schema is not versioned, this returns the original object unchanged.
 *
 * @param schema - A JSON Schema object from `describeWorkspace()`
 * @returns The highest-version object schema when `oneOf` is present, otherwise the original schema
 *
 * @example
 * ```typescript
 * const resolved = resolveSchema({
 *   oneOf: [
 *     { type: 'object', properties: { _v: { const: 1 }, id: { type: 'string' } } },
 *     { type: 'object', properties: { _v: { const: 2 }, id: { type: 'string' }, title: { type: 'string' } } },
 *   ],
 * });
 *
 * // Picks the `_v: 2` schema
 * console.log((resolved.properties as Record<string, unknown>).title);
 * ```
 */
export function resolveSchema(schema: JsonSchema): JsonSchema {
	const candidates = Array.isArray(schema.oneOf)
		? schema.oneOf.filter(isRecord)
		: undefined;

	if (candidates === undefined || candidates.length === 0) {
		return schema;
	}

	let resolved: JsonSchema | undefined;
	let highestVersion = Number.NEGATIVE_INFINITY;

	for (const candidate of candidates) {
		const version = getSchemaVersion(candidate);
		if (resolved === undefined || version > highestVersion) {
			resolved = candidate;
			highestVersion = version;
		}
	}

	if (resolved === undefined) {
		return schema;
	}

	return resolved;
}

/** Double-quote a SQL identifier, escaping embedded quotes. */
export function quoteIdentifier(identifier: string) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

// ════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getSchemaVersion(schema: JsonSchema) {
	const properties = schema.properties;
	if (!isRecord(properties)) {
		return Number.NEGATIVE_INFINITY;
	}

	const versionSchema = properties._v;
	if (!isRecord(versionSchema) || typeof versionSchema.const !== 'number') {
		return Number.NEGATIVE_INFINITY;
	}

	return versionSchema.const;
}

function columnDef(
	name: string,
	propSchema: JsonSchema,
	isRequired: boolean,
): string {
	const quotedName = quoteIdentifier(name);

	if (name === 'id') {
		return `${quotedName} TEXT PRIMARY KEY`;
	}

	if (name === '_v' && typeof propSchema.const === 'number') {
		return `${quotedName} INTEGER NOT NULL`;
	}

	if (Array.isArray(propSchema.enum)) {
		return appendNullability(`${quotedName} TEXT`, isRequired);
	}

	const jsonType =
		typeof propSchema.type === 'string' ? propSchema.type : undefined;

	switch (jsonType) {
		case 'string':
			return appendNullability(`${quotedName} TEXT`, isRequired);
		case 'number':
			return appendNullability(`${quotedName} REAL`, isRequired);
		case 'integer':
			return appendNullability(`${quotedName} INTEGER`, isRequired);
		case 'boolean':
			return appendNullability(`${quotedName} INTEGER`, isRequired);
		case 'object':
		case 'array':
			return appendNullability(`${quotedName} TEXT`, isRequired);
		default:
			return appendNullability(`${quotedName} TEXT`, isRequired);
	}
}

function appendNullability(column: string, isRequired: boolean) {
	if (!isRequired) {
		return column;
	}

	return `${column} NOT NULL`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
