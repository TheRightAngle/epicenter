/**
 * SQLite materializer—mirrors workspace table rows into queryable SQLite tables.
 *
 * Follows the same builder pattern as the markdown materializer:
 * `createSqliteMaterializer(ctx, config)` returns a chainable builder where
 * `.table(name, config?)` opts in per table. Nothing materializes by default.
 *
 * The materializer awaits `ctx.whenReady` before touching SQLite, so persistence
 * and sync have loaded before the initial flush. All `.table()` calls happen
 * synchronously in the factory closure before `whenReady` resolves.
 *
 * @module
 */

import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { standardSchemaToJsonSchema } from '../../../shared/standard-schema.js';
import type { BaseRow, TableHelper } from '../../../workspace/types.js';
import { generateDdl, quoteIdentifier } from './ddl.js';
import { ftsSearch, setupFtsTable } from './fts.js';
import type {
	MirrorDatabase,
	SearchOptions,
	SearchResult,
	TableMaterializerConfig,
} from './types.js';

// biome-ignore lint/suspicious/noExplicitAny: generic bound for heterogeneous table helpers
type AnyTableHelper = TableHelper<any>;

/**
 * Create a one-way materializer that mirrors workspace table rows into SQLite.
 *
 * Nothing materializes by default. Call `.table()` to opt in per table, each
 * with optional FTS5 and custom serialization config. Table names are
 * type-checked against the workspace definition—typos are caught at compile time.
 *
 * The materializer awaits `ctx.whenReady` before reading data, so persistence
 * and sync have loaded before the initial flush. All `.table()` calls happen
 * synchronously in the factory closure before `whenReady` resolves.
 *
 * @example Basic usage with type-safe table names
 * ```typescript
 * .withWorkspaceExtension('sqlite', (ctx) =>
 *   createSqliteMaterializer(ctx, { db })
 *     .table('posts', { fts: ['title', 'body'] })
 *     .table('users')
 * )
 * ```
 *
 * @example Shared SQLite file for persistence + materializer (desktop/Bun)
 * ```typescript
 * import { Database } from 'bun:sqlite';
 * import { filesystemPersistence } from '@epicenter/workspace/extensions/persistence/sqlite';
 * import { createSqliteMaterializer } from '@epicenter/workspace/extensions/materializer/sqlite';
 *
 * // Persistence opens its own connection internally.
 * // Materializer uses a second connection to the same WAL-mode file.
 * createWorkspace(definition)
 *   .withExtension('persistence', filesystemPersistence({ filePath: 'workspace.db' }))
 *   .withWorkspaceExtension('sqlite', (ctx) =>
 *     createSqliteMaterializer(ctx, { db: new Database('workspace.db') })
 *       .table('posts', { fts: ['title'] })
 *   )
 * ```
 */
export function createSqliteMaterializer<
	TTables extends Record<string, AnyTableHelper>,
>(
	ctx: {
		tables: TTables;
		definitions: { tables: Record<string, unknown> };
		whenReady: Promise<void>;
	},
	config: { db: MirrorDatabase; debounceMs?: number },
) {
	const { db } = config;
	const debounceMs = config.debounceMs ?? 100;

	const tableConfigs = new Map<string, TableMaterializerConfig>();
	const unsubscribes: Array<() => void> = [];
	let pendingSync = new Map<string, Set<string>>();
	let syncTimeout: ReturnType<typeof setTimeout> | null = null;
	let syncQueue = Promise.resolve();
	let isDisposed = false;

	// ── SQL primitives ───────────────────────────────────────────

	function insertRow(tableName: string, row: BaseRow) {
		const serialize = tableConfigs.get(tableName)?.serialize ?? serializeValue;
		const keys = Object.keys(row);
		const placeholders = keys.map(() => '?').join(', ');
		const values = keys.map((key) => serialize(row[key]));
		const columns = keys.map(quoteIdentifier).join(', ');

		db.prepare(
			`INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${placeholders})`,
		).run(...values);
	}

	function deleteRow(tableName: string, id: string) {
		db.prepare(
			`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier('id')} = ?`,
		).run(id);
	}

	// ── Full load ────────────────────────────────────────────────

	function fullLoadTable(
		tableName: string,
		table: TableHelper<BaseRow>,
	) {
		const serialize = tableConfigs.get(tableName)?.serialize ?? serializeValue;
		const rows = table.getAllValid();
		if (rows.length === 0) {
			return;
		}

		const keys = Object.keys(rows[0]!);
		const placeholders = keys.map(() => '?').join(', ');
		const columns = keys.map(quoteIdentifier).join(', ');
		const stmt = db.prepare(
			`INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${placeholders})`,
		);

		for (const row of rows) {
			const values = keys.map((key) => serialize(row[key]));
			stmt.run(...values);
		}
	}

	// ── Sync engine ──────────────────────────────────────────────

	function scheduleSync(tableName: string, changedIds: ReadonlySet<string>) {
		if (isDisposed) {
			return;
		}

		let tableIds = pendingSync.get(tableName);
		if (tableIds === undefined) {
			tableIds = new Set<string>();
			pendingSync.set(tableName, tableIds);
		}

		for (const id of changedIds) {
			tableIds.add(id);
		}

		if (syncTimeout !== null) {
			clearTimeout(syncTimeout);
		}

		syncTimeout = setTimeout(() => {
			syncTimeout = null;
			syncQueue = syncQueue
				.then(() => flushPendingSync())
				.catch((error: unknown) => {
					console.error(
						'[createSqliteMaterializer] Failed to sync SQLite materializer.',
						error,
					);
				});
		}, debounceMs);
	}

	function flushPendingSync() {
		if (isDisposed) {
			return;
		}

		const currentPending = pendingSync;
		pendingSync = new Map<string, Set<string>>();

		for (const [tableName, ids] of currentPending) {
			const table = ctx.tables[tableName];
			if (table === undefined) {
				continue;
			}

			for (const id of ids) {
				const result = table.get(id);

				switch (result.status) {
					case 'valid': {
						insertRow(tableName, result.row);
						break;
					}

					case 'invalid':
					case 'not_found': {
						deleteRow(tableName, id);
						break;
					}
				}
			}
		}
	}

	// ── Public methods ───────────────────────────────────────────

	/**
	 * FTS5 search across a materialized table.
	 *
	 * Only works for tables with `fts` configured in their `.table()` config.
	 * Returns empty array if FTS is not configured for the given table.
	 */
	function search(
		tableName: string,
		query: string,
		options?: SearchOptions,
	): SearchResult[] {
		if (isDisposed) {
			return [];
		}

		const tableConfig = tableConfigs.get(tableName);
		const ftsColumns = tableConfig?.fts;
		if (ftsColumns === undefined || ftsColumns.length === 0) {
			return [];
		}

		return ftsSearch(db, tableName, ftsColumns, query, options);
	}

	/**
	 * Return the row count for a materialized table.
	 *
	 * Convenience wrapper around `SELECT COUNT(*) FROM table`. Returns 0
	 * for tables that haven't been loaded yet or don't exist.
	 */
	function count(tableName: string): number {
		if (isDisposed) {
			return 0;
		}

		try {
			const row = db
				.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)
				.get();
			return Number(row?.count ?? 0);
		} catch {
			return 0;
		}
	}

	/**
	 * Rebuild all materialized tables from Yjs source of truth.
	 *
	 * Drops existing data and performs a fresh full load for every
	 * registered table. Useful after schema changes or suspected drift.
	 */
	function rebuild(tableName?: string): void {
		if (isDisposed) {
			return;
		}

		if (tableName !== undefined) {
			if (!tableConfigs.has(tableName)) {
				throw new Error(
					`Cannot rebuild "${tableName}" — not in the materialized table set.`,
				);
			}

			const table = ctx.tables[tableName];
			if (table === undefined) {
				return;
			}

			db.run('BEGIN');
			try {
				db.run(`DELETE FROM ${quoteIdentifier(tableName)}`);
				fullLoadTable(tableName, table);
				db.run('COMMIT');
			} catch (error: unknown) {
				db.run('ROLLBACK');
				throw error;
			}
			return;
		}

		db.run('BEGIN');
		try {
			for (const [name] of tableConfigs) {
				db.run(`DELETE FROM ${quoteIdentifier(name)}`);
			}
			for (const [name] of tableConfigs) {
				const table = ctx.tables[name];
				if (table === undefined) {
					continue;
				}
				fullLoadTable(name, table);
			}
			db.run('COMMIT');
		} catch (error: unknown) {
			db.run('ROLLBACK');
			throw error;
		}
	}

	function dispose() {
		isDisposed = true;

		if (syncTimeout !== null) {
			clearTimeout(syncTimeout);
			syncTimeout = null;
		}

		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────

	async function initialize() {
		await ctx.whenReady;

		if (isDisposed) {
			return;
		}

		// Create tables and FTS indexes
		for (const [tableName, tableConfig] of tableConfigs) {
			const jsonSchema = getTableJsonSchema(ctx, tableName);
			db.run(generateDdl(tableName, jsonSchema));

			if (tableConfig.fts && tableConfig.fts.length > 0) {
				await setupFtsTable(db, tableName, tableConfig.fts);
			}
		}

		if (isDisposed) {
			return;
		}

		// Full load all tables in a transaction
		db.run('BEGIN');
		try {
			for (const [tableName] of tableConfigs) {
				const table = ctx.tables[tableName];
				if (table === undefined) {
					continue;
				}
				fullLoadTable(tableName, table);
			}
			db.run('COMMIT');
		} catch (error: unknown) {
			db.run('ROLLBACK');
			throw error;
		}

		if (isDisposed) {
			return;
		}

		// Register observers for incremental sync
		for (const [tableName] of tableConfigs) {
			const table = ctx.tables[tableName];
			if (table === undefined) {
				continue;
			}

			const unsubscribe = table.observe((changedIds) => {
				scheduleSync(tableName, changedIds);
			});
			unsubscribes.push(unsubscribe);
		}
	}

	// ── Builder ──────────────────────────────────────────────────

	type MaterializerBuilder = {
		/**
		 * Opt in a workspace table for SQLite materialization.
		 *
		 * Each call registers one table with optional FTS5 and serialization config.
		 * Chainable — returns the builder for fluent API usage. Table names are
		 * type-checked against the workspace definition.
		 *
		 * @param name - The workspace table name to materialize
		 * @param tableConfig - Optional per-table configuration (FTS columns, custom serializer)
		 *
		 * @example
		 * ```typescript
		 * createSqliteMaterializer(ctx, { db })
		 *   .table('posts', { fts: ['title', 'body'] })
		 *   .table('users')
		 * ```
		 */
		table<TName extends keyof TTables & string>(
			name: TName,
			tableConfig?: TableMaterializerConfig,
		): MaterializerBuilder;
		whenReady: Promise<void>;
		dispose(): void;
		search(
			table: keyof TTables & string,
			query: string,
			options?: SearchOptions,
		): SearchResult[];
		count(table: keyof TTables & string): number;
		rebuild(table?: keyof TTables & string): void;
		db: MirrorDatabase;
	};

	const builder: MaterializerBuilder = {
		table(name, tableConfig) {
			tableConfigs.set(name, tableConfig ?? {});
			return builder;
		},
		whenReady: initialize(),
		dispose,
		search,
		count,
		rebuild,
		db,
	};

	return builder;
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getTableJsonSchema(
	context: { definitions: { tables: Record<string, unknown> } },
	tableName: string,
): Record<string, unknown> {
	const tableDef = context.definitions.tables[tableName];
	if (tableDef === null || tableDef === undefined) {
		throw new Error(
			`SQLite materializer definition for "${tableName}" is missing.`,
		);
	}

	// Table definitions may wrap the schema in a { schema } property or be
	// the Standard Schema directly (e.g. an arktype Type which is callable).
	const schema =
		isRecord(tableDef) && 'schema' in tableDef ? tableDef.schema : tableDef;

	if (
		schema === null ||
		schema === undefined ||
		(typeof schema !== 'object' && typeof schema !== 'function') ||
		!('~standard' in schema)
	) {
		throw new Error(
			`SQLite materializer definition for "${tableName}" is not a Standard Schema (missing ~standard).`,
		);
	}

	return standardSchemaToJsonSchema(schema as StandardJSONSchemaV1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert a workspace row value into a SQLite-compatible value.
 *
 * - `null` / `undefined` → SQL `NULL`
 * - `object` / `array` → JSON string (`TEXT` column)
 * - `boolean` → `0` or `1` (`INTEGER` column)
 * - everything else → passed through as-is
 */
export function serializeValue(value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === 'object') {
		return JSON.stringify(value);
	}

	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}

	return value;
}

