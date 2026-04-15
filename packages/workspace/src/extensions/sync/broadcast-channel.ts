import * as Y from 'yjs';

/** Origin sentinel — updates applied from the BroadcastChannel carry this
 *  so the `updateV2` handler skips re-broadcasting them (prevents echo loops). */
export const BC_ORIGIN = Symbol('bc-sync');

/**
 * BroadcastChannel cross-tab sync for a Yjs document.
 *
 * Broadcasts every local `updateV2` to same-origin tabs and applies incoming
 * updates from other tabs. Uses `ydoc.guid` (= workspace ID) as the channel
 * name so only docs for the same workspace communicate.
 *
 * Skips re-broadcasting updates that arrived from BroadcastChannel itself
 * (via `BC_ORIGIN`) and, when paired with WebSocket, updates that arrived
 * from the server (via `transportOrigin`). Without the second guard,
 * server-delivered updates would be re-broadcast to other tabs, and those
 * tabs would re-send them to the server—creating an echo loop.
 *
 * Yjs deduplicates internally—if an already-applied update is re-applied,
 * it's a no-op and no `updateV2` event fires. But `onUpdate` callbacks
 * that generate fresh timestamps (e.g., `DateTimeString.now()`) produce
 * NEW updates that bypass dedup, so origin-based guards are essential.
 *
 * No-ops gracefully when `BroadcastChannel` is unavailable (Node.js, SSR,
 * older browsers).
 *
 * Included automatically by `createSyncExtension`—most apps don't need to
 * register this separately. Use the standalone export only when you want
 * cross-tab sync without a WebSocket server (e.g., offline-only apps).
 *
 * @param ydoc - The Y.Doc to sync across tabs
 * @param transportOrigin - Optional origin Symbol from another transport
 *   (e.g., `SYNC_ORIGIN` from the WebSocket extension). Updates with this
 *   origin are not re-broadcast, preventing cross-transport echo loops.
 *   Omit when using BroadcastChannel standalone (no WebSocket).
 *
 * @example Standalone (no server, local tabs only)
 * ```typescript
 * import { indexeddbPersistence } from '@epicenter/workspace/extensions/persistence/indexeddb';
 * import { broadcastChannelSync } from '@epicenter/workspace/extensions/sync/broadcast-channel';
 *
 * createWorkspace(definition)
 *   .withExtension('persistence', indexeddbPersistence)
 *   .withExtension('broadcast', broadcastChannelSync)
 * ```
 */
export function broadcastChannelSync({ ydoc, transportOrigin }: { ydoc: Y.Doc; transportOrigin?: symbol }) {
	if (typeof BroadcastChannel === 'undefined') return {};

	const channel = new BroadcastChannel(`yjs:${ydoc.guid}`);

	/** Broadcast local changes to other tabs.
	 *  Skips updates from BroadcastChannel itself (echo prevention) and from
	 *  the paired transport (e.g., WebSocket) to avoid cross-transport echo. */
	const handleUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === BC_ORIGIN) return;
		if (transportOrigin && origin === transportOrigin) return;
		channel.postMessage(update);
	};
	ydoc.on('updateV2', handleUpdate);

	/** Apply incoming changes from other tabs. */
	channel.onmessage = (event: MessageEvent) => {
		Y.applyUpdateV2(ydoc, new Uint8Array(event.data), BC_ORIGIN);
	};

	return {
		dispose() {
			ydoc.off('updateV2', handleUpdate);
			channel.close();
		},
	};
}
