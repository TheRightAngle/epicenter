/**
 * Public type surface for the SQLite materializer.
 *
 * This module stays implementation-free on purpose. Consumers can import the
 * materializer's config types, search types, and injected database contract
 * without pulling in a specific SQLite driver.
 *
 * @packageDocumentation
 */

/**
 * Minimal database interface for the SQLite materializer.
 *
 * Structurally compatible with `bun:sqlite`'s `Database` and
 * `better-sqlite3`'s `Database`. Consumers pass their driver directly—
 * no wrapping needed.
 *
 * @example
 * ```typescript
 * import { Database } from 'bun:sqlite';
 * const db: MirrorDatabase = new Database('materializer.db');
 * ```
 */
export type MirrorDatabase = {
	/** Execute raw SQL that does not return rows. */
	run(sql: string): unknown;

	/** Prepare a reusable statement for repeated reads or writes. */
	prepare(sql: string): MirrorStatement;
};

/**
 * Minimal prepared statement interface used by the SQLite materializer.
 *
 * Structurally compatible with `bun:sqlite`'s `Statement` and
 * `better-sqlite3`'s `Statement` without importing either driver.
 *
 * @example
 * ```typescript
 * const stmt = db.prepare('SELECT * FROM posts WHERE id = ?');
 * const row = stmt.get('post_123');
 * ```
 */
export type MirrorStatement = {
	/** Run a statement that writes data or otherwise returns no rows. */
	run(...params: unknown[]): unknown;

	/** Fetch all matching rows as plain objects. */
	all(...params: unknown[]): Record<string, unknown>[];

	/** Fetch the first matching row, or null if none found. */
	get(...params: unknown[]): Record<string, unknown> | null;
};

/**
 * Per-table configuration for the SQLite materializer builder.
 *
 * Passed to `.table(name, config?)` to customize FTS5 indexing
 * and value serialization for individual tables.
 *
 * @example
 * ```typescript
 * createSqliteMaterializer(ctx, { db: new Database(':memory:') })
 *   .table('posts', {
 *     fts: ['title', 'body'],
	 *     serialize: (value) => customTransform(value),
 *   })
 * ```
 */
export type TableMaterializerConfig = {
	/** Column names to include in FTS5 full-text search index. */
	fts?: string[];

	/** Optional per-column value serializer override. */
	serialize?: (value: unknown) => unknown;
};

/**
 * Optional arguments for FTS5 searches.
 *
 * Use this when you want to cap result count or choose which indexed column is
 * used for snippets in the search response.
 */
export type SearchOptions = {
	/** Maximum number of matches to return. */
	limit?: number;

	/** Column name used to generate the snippet text. */
	snippetColumn?: string;
};

/**
 * One full-text search result returned by the materializer.
 *
 * `id` points back to the materialized row, `snippet` is display-ready text, and
 * `rank` is the database-provided relevance score.
 */
export type SearchResult = {
	/** ID of the materialized row that matched the query. */
	id: string;

	/** Snippet generated from indexed text content. */
	snippet: string;

	/** Relevance score returned by the FTS query. */
	rank: number;
};
