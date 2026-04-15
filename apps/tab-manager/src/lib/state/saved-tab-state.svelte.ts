/**
 * Reactive saved tab state for the side panel.
 *
 * Read-only reactive layer backed by `fromTable()` — provides granular
 * per-row reactivity via `SvelteMap`. All write operations are delegated
 * to workspace actions defined in `client.ts`.
 *
 * The public API exposes a `$derived` sorted array since the access
 * pattern is always "render the full sorted list."
 *
 * @example
 * ```svelte
 * <script>
 *   import { savedTabState } from '$lib/state/saved-tab-state.svelte';
 * </script>
 *
 * {#each savedTabState.tabs as tab (tab.id)}
 *   <SavedTabItem {tab} />
 * {/each}
 *
 * <button onclick={() => savedTabState.restoreAll()}>
 *   Restore all
 * </button>
 * ```
 */

import { fromTable } from '@epicenter/svelte';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { tryAsync } from 'wellcrafted/result';
import { workspace } from '$lib/client';
import type { BrowserTab } from '$lib/state/browser-state.svelte';
import type { SavedTab, SavedTabId } from '$lib/workspace';

export const SavedTabError = defineErrors({
	SaveFailed: ({ url, cause }: { url: string; cause: unknown }) => ({
		message: `Failed to save tab '${url}': ${extractErrorMessage(cause)}`,
		url,
		cause,
	}),
	RestoreFailed: ({ id, cause }: { id: string; cause: unknown }) => ({
		message: `Failed to restore saved tab '${id}': ${extractErrorMessage(cause)}`,
		id,
		cause,
	}),
	RestoreAllFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to restore all saved tabs: ${extractErrorMessage(cause)}`,
		cause,
	}),
	RemoveFailed: ({ id, cause }: { id: string; cause: unknown }) => ({
		message: `Failed to remove saved tab '${id}': ${extractErrorMessage(cause)}`,
		id,
		cause,
	}),
	RemoveAllFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to remove all saved tabs: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type SavedTabError = InferErrors<typeof SavedTabError>;

function createSavedTabState() {
	const tabsMap = fromTable(workspace.tables.savedTabs);

	/** All saved tabs, sorted by most recently saved first. Cached via $derived. */
	const tabs = $derived(
		tabsMap
			.values()
			.toArray()
			.sort((a, b) => b.savedAt - a.savedAt),
	);

	return {
		get tabs() {
			return tabs;
		},

		/**
		 * Save a tab — snapshot its metadata to Y.Doc and close the browser tab.
		 *
		 * Delegates to the `savedTabs.save` workspace action so the operation
		 * is AI-callable and follows the same code path as programmatic saves.
		 * Silently no-ops for tabs without a URL.
		 */
		async save(tab: BrowserTab) {
			if (!tab.url) return;
			const url = tab.url;
			return tryAsync({
				try: () =>
					workspace.actions.savedTabs.save({
						browserTabId: tab.id,
						url,
						title: tab.title || 'Untitled',
						favIconUrl: tab.favIconUrl,
						pinned: tab.pinned,
					}),
				catch: (cause) => SavedTabError.SaveFailed({ url, cause }),
			});
		},

		/**
		 * Restore a saved tab — re-open in browser and delete the record.
		 *
		 * Delegates to the `savedTabs.restore` workspace action.
		 */
		async restore(savedTab: SavedTab) {
			return tryAsync({
				try: () =>
					workspace.actions.savedTabs.restore({
						id: savedTab.id,
						url: savedTab.url,
						pinned: savedTab.pinned,
					}),
				catch: (cause) =>
					SavedTabError.RestoreFailed({ id: savedTab.id, cause }),
			});
		},

		/**
		 * Restore all saved tabs at once.
		 *
		 * Delegates to the `savedTabs.restoreAll` workspace action which
		 * fires all tab creations in parallel and batch-deletes from Y.Doc.
		 */
		async restoreAll() {
			return tryAsync({
				try: () => workspace.actions.savedTabs.restoreAll({}),
				catch: (cause) => SavedTabError.RestoreAllFailed({ cause }),
			});
		},

		/**
		 * Delete a saved tab without restoring it.
		 *
		 * Delegates to the `savedTabs.remove` workspace action.
		 */
		async remove(id: SavedTabId) {
			return tryAsync({
				try: () => workspace.actions.savedTabs.remove({ id }),
				catch: (cause) => SavedTabError.RemoveFailed({ id, cause }),
			});
		},

		/**
		 * Delete all saved tabs without restoring them.
		 *
		 * Delegates to the `savedTabs.removeAll` workspace action.
		 */
		async removeAll() {
			return tryAsync({
				try: () => workspace.actions.savedTabs.removeAll({}),
				catch: (cause) => SavedTabError.RemoveAllFailed({ cause }),
			});
		},
	};
}

export const savedTabState = createSavedTabState();
