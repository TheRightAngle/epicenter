/**
 * Reactive state for Fuji—entries, view preferences, and search.
 *
 * Three exports:
 * - `entriesState` — active/deleted entry collections from the workspace table
 * - `viewState` — persisted view mode, sort preference, and search query
 * - `matchesEntrySearch` — pure function for filtering entries by query
 *
 * @example
 * ```svelte
 * <script>
 *   import { entriesState, viewState } from '$lib/entries.svelte';
 * </script>
 *
 * {#each entriesState.active as entry (entry.id)}
 *   <p>{entry.title}</p>
 * {/each}
 * ```
 */

import { goto } from '$app/navigation';
import { fromKv, fromTable } from '@epicenter/svelte';
import { workspace } from '$lib/client';
import type { EntryId } from '$lib/workspace';

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Test whether an entry matches a search query.
 *
 * Checks title, subtitle, tags, and type fields against a
 * case-insensitive substring match. Returns true if any field
 * contains the query.
 */
export function matchesEntrySearch(
	entry: { title: string; subtitle: string; tags: string[]; type: string[] },
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	const title = entry.title.toLowerCase();
	const subtitle = entry.subtitle.toLowerCase();
	const tags = entry.tags.join(' ').toLowerCase();
	const types = entry.type.join(' ').toLowerCase();
	return (
		title.includes(q) ||
		subtitle.includes(q) ||
		tags.includes(q) ||
		types.includes(q)
	);
}

// ─── Entries State ───────────────────────────────────────────────────────────

function createEntriesState() {
	const map = fromTable(workspace.tables.entries);
	const all = $derived(map.values().toArray());
	const active = $derived(all.filter((e) => e.deletedAt === undefined));
	const deleted = $derived(all.filter((e) => e.deletedAt !== undefined));

	return {
		/** Look up an entry by ID. Returns `undefined` if not found. */
		get(id: EntryId) {
			return map.get(id);
		},

		/** Active entries—not soft-deleted. Computed once per change cycle. */
		get active() {
			return active;
		},

		/** Soft-deleted entries—has `deletedAt` set. Computed once per change cycle. */
		get deleted() {
			return deleted;
		},

		/**
		 * Create a new entry with sensible defaults and navigate to it.
		 *
		 * Delegates to the workspace `entries.create` action, then
		 * navigates to `/entries/{id}` so the editor opens immediately.
		 */
		createEntry() {
			const { id } = workspace.actions.entries.create({});
			goto(`/entries/${id}`);
		},
	};
}

export const entriesState = createEntriesState();

// ─── View State ──────────────────────────────────────────────────────────────

function createViewState() {
	const viewModeKv = fromKv(workspace.kv, 'viewMode');
	const sortByKv = fromKv(workspace.kv, 'sortBy');
	let searchQuery = $state('');

	return {
		get viewMode(): 'table' | 'timeline' {
			return viewModeKv.current ?? 'table';
		},

		/**
		 * Toggle between table and timeline view modes.
		 *
		 * Persisted via workspace KV so the preference survives reloads
		 * and syncs across devices.
		 */
		toggleViewMode() {
			viewModeKv.current =
				viewModeKv.current === 'table' ? 'timeline' : 'table';
		},

		get sortBy(): 'date' | 'updatedAt' | 'createdAt' | 'title' | 'rating' {
			return sortByKv.current ?? 'date';
		},

		/**
		 * Set the sort preference. Persisted via workspace KV so it survives
		 * reloads and syncs across devices.
		 */
		set sortBy(value: 'date' | 'updatedAt' | 'createdAt' | 'title' | 'rating') {
			sortByKv.current = value;
		},

		get searchQuery() {
			return searchQuery;
		},

		/** Update the search query. Used by the sidebar search input. */
		set searchQuery(value: string) {
			searchQuery = value;
		},
	};
}

export const viewState = createViewState();
