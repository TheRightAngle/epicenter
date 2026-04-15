import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/**
 * IndexedDB persistence for a Yjs document.
 *
 * Stores the document in the browser's IndexedDB using `ydoc.guid` as the
 * database name. Loads existing state on creation and auto-saves on every
 * Yjs update (both handled internally by `y-indexeddb`).
 *
 * Works directly as an extension factory — destructures `ydoc` from the
 * workspace client context. Chain first so all subsequent extensions
 * (sync, which now includes BroadcastChannel) start with local state already loaded.
 *
 * @example Persistence + sync (BroadcastChannel included automatically)
 * ```typescript
 * import { indexeddbPersistence } from '@epicenter/workspace/extensions/persistence/indexeddb';
 * import { createSyncExtension } from '@epicenter/workspace/extensions/sync/websocket';
 *
 * createWorkspace(definition)
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withExtension('sync', createSyncExtension({
 *     url: (id) => `ws://localhost:3913/rooms/${id}`,
 *   }))
 * ```
 *
 * @example Standalone persistence (no sync)
 * ```typescript
 * createWorkspace(definition)
 *   .withExtension('persistence', indexeddbPersistence)
 * ```
 */
export function indexeddbPersistence({ ydoc }: { ydoc: Y.Doc }) {
	const idb = new IndexeddbPersistence(ydoc.guid, ydoc);
	return {
		clearLocalData: () => idb.clearData(),
		// y-indexeddb's whenSynced = "data loaded from IndexedDB"
		whenReady: idb.whenSynced,
		dispose: () => idb.destroy(),
	};
}
