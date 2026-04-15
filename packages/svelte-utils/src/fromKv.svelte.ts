import type {
	InferKvValue,
	KvDefinitions,
	KvHelper,
} from '@epicenter/workspace';

/**
 * Create a reactive binding to a single workspace KV key.
 *
 * Mirrors Svelte 5's `fromStore()` pattern—wraps an external data source
 * into a reactive `{ current }` box. Reading `.current` is reactive (triggers
 * re-renders). Writing `.current` calls `kv.set()` under the hood.
 *
 * The observer fires on both local and remote changes (Yjs CRDT sync).
 * On delete, falls back to the KV definition's `defaultValue` via `kv.get()`.
 *
 * @example
 * ```typescript
 * const selectedFolderId = fromKv(workspaceClient.kv, 'selectedFolderId');
 *
 * // Read (reactive):
 * console.log(selectedFolderId.current); // FolderId | null
 *
 * // Write (calls kv.set):
 * selectedFolderId.current = newFolderId;
 * ```
 */
export function fromKv<
	TDefs extends KvDefinitions,
	K extends keyof TDefs & string,
>(
	kv: KvHelper<TDefs>,
	key: K,
): { current: InferKvValue<TDefs[K]>; destroy: () => void } {
	let value = $state(kv.get(key));

	const unobserve = kv.observe(key, (change) => {
		value = change.type === 'set' ? change.value : kv.get(key);
	});

	return {
		get current() {
			return value;
		},
		set current(newValue: InferKvValue<TDefs[K]>) {
			kv.set(key, newValue);
		},
		destroy: unobserve,
	};
}
