import type { BaseRow, TableHelper } from '@epicenter/workspace';
import { SvelteMap } from 'svelte/reactivity';

/**
 * Create a reactive SvelteMap binding to a workspace table.
 *
 * Returns a `SvelteMap<id, Row>` that stays in sync with the underlying
 * Yjs table via granular per-row updates. Only changed rows trigger
 * re-renders—not the entire collection.
 *
 * Read-only—mutations go through `table.set()`, `table.update()`, etc.
 * The observer picks up changes from both local writes and remote CRDT sync.
 *
 * @example
 * ```typescript
 * const entries = fromTable(workspaceClient.tables.entries);
 *
 * // Per-item access (reactive):
 * const entry = entries.get(id);
 *
 * // Iterate (reactive):
 * for (const [id, entry] of entries) { ... }
 *
 * // Array access:
 * const all = [...entries.values()];
 *
 * // Derived state:
 * const filtered = $derived([...entries.values()].filter(e => !e.deletedAt));
 * ```
 */
export function fromTable<TRow extends BaseRow>(
	table: TableHelper<TRow>,
): SvelteMap<string, TRow> & { destroy: () => void } {
	const map = new SvelteMap<string, TRow>();

	// Seed with current valid rows
	for (const row of table.getAllValid()) {
		map.set(row.id, row);
	}

	// Granular updates — only touch changed rows
	const unobserve = table.observe((changedIds) => {
		for (const id of changedIds) {
			const result = table.get(id);
			switch (result.status) {
				case 'valid':
					map.set(id, result.row);
					break;
				case 'not_found':
				case 'invalid':
					map.delete(id);
					break;
			}
		}
	});

	return Object.assign(map, { destroy: unobserve });
}
