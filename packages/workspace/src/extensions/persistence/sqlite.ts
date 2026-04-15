import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';

/** Max compacted update size (2 MB). Matches the Cloudflare DO limit. */
const MAX_COMPACTED_BYTES = 2 * 1024 * 1024;

/**
 * Compact when accumulated incremental updates exceed this size.
 *
 * Targets the real problem: large row replacements (e.g. 30 KB autosaves)
 * accumulating over long desktop sessions. At 2 MB the log is guaranteed to
 * be 10–50× larger than the compact doc for typical workloads. Low enough to
 * prevent multi-MB logs; high enough to ignore thousands of tiny keystroke
 * updates that total only a few hundred KB.
 */
const COMPACTION_BYTE_THRESHOLD = 2 * 1024 * 1024;

/**
 * Debounce compaction by 5 s after the byte threshold is crossed.
 *
 * Prevents compacting during a burst of rapid writes (e.g. bulk import).
 * The compaction itself is fast (~16 ms for 10 K rows) but we don't want
 * to interrupt a hot write path.
 */
const COMPACTION_DEBOUNCE_MS = 5_000;

/**
 * Compact the SQLite update log into a single row.
 *
 * Encodes the current doc state via `Y.encodeStateAsUpdateV2`—produces
 * smaller output than merging individual updates. No-ops if the log already
 * has ≤ 1 row or the compacted blob exceeds 2 MB.
 *
 * @returns `true` if compaction ran, `false` if it no-oped.
 */
function compactUpdateLog(db: Database, ydoc: Y.Doc): boolean {
	const row = db.query('SELECT COUNT(*) as count FROM updates').get() as {
		count: number;
	};
	if (row.count <= 1) return false;

	const compacted = Y.encodeStateAsUpdateV2(ydoc);
	if (compacted.byteLength > MAX_COMPACTED_BYTES) return false;

	db.transaction(() => {
		db.run('DELETE FROM updates');
		db.run('INSERT INTO updates (data) VALUES (?)', [compacted]);
	})();
	return true;
}

/**
 * Filesystem persistence factory using SQLite append-log.
 *
 * Stores incremental Y.Doc updates in a SQLite database using the same
 * append-only update log pattern as the Cloudflare Durable Object sync server.
 * Each update is a tiny INSERT (O(update_size)), not a full doc re-encode.
 *
 * Compaction runs at three points:
 * 1. **Cold start** — replay + compact on initialization
 * 2. **Byte threshold** — when accumulated bytes since last compaction exceed
 *    2 MB, a debounced compaction fires (targets long desktop sessions with
 *    frequent large-value autosaves)
 * 3. **Dispose** — final compact on shutdown
 *
 * **Platform**: Desktop (Tauri, Bun)
 *
 * @example
 * ```typescript
 * import { filesystemPersistence } from '@epicenter/workspace/extensions/persistence/sqlite';
 * import { createSyncExtension } from '@epicenter/workspace/extensions/sync/websocket';
 *
 * createWorkspace(definition)
 *   .withExtension('persistence', filesystemPersistence({
 *     filePath: join(epicenterDir, 'persistence', `workspace.db`),
 *   }))
 *   .withExtension('sync', createSyncExtension({
 *     url: (id) => `ws://localhost:3913/rooms/${id}`,
 *   }))
 * ```
 */
export function filesystemPersistence({ filePath }: { filePath: string }) {
	return ({ ydoc }: { ydoc: Y.Doc }) => {
		let db: Database | null = null;
		let bytesSinceCompaction = 0;
		let compactionTimer: ReturnType<typeof setTimeout> | null = null;

		function resetCompactionTimer() {
			if (compactionTimer) {
				clearTimeout(compactionTimer);
				compactionTimer = null;
			}
		}

		const updateHandler = (update: Uint8Array) => {
			db?.run('INSERT INTO updates (data) VALUES (?)', [update]);

			bytesSinceCompaction += update.byteLength;
			if (bytesSinceCompaction > COMPACTION_BYTE_THRESHOLD) {
				resetCompactionTimer();
				compactionTimer = setTimeout(() => {
					if (db && compactUpdateLog(db, ydoc)) {
						bytesSinceCompaction = 0;
					}
				}, COMPACTION_DEBOUNCE_MS);
			}
		};

		const whenReady = (async () => {
			await mkdir(path.dirname(filePath), { recursive: true });

			db = new Database(filePath);
			db.run(
				'CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)',
			);

			const rows = db.query('SELECT data FROM updates ORDER BY id').all() as {
				data: Buffer;
			}[];
			for (const row of rows) {
				Y.applyUpdateV2(ydoc, new Uint8Array(row.data));
			}

			compactUpdateLog(db, ydoc);
			ydoc.on('updateV2', updateHandler);
		})();

		return {
			whenReady,
			clearLocalData: () => {
				if (db) {
					db.run('DELETE FROM updates');
				}
			},
			dispose: () => {
				resetCompactionTimer();
				ydoc.off('updateV2', updateHandler);
				if (db) {
					compactUpdateLog(db, ydoc);
					db.close();
				}
			},
		};
	};
}
