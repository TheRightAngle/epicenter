/**
 * Create a lazily-initialized value that computes on first access and caches the result.
 *
 * This solves a common pattern where you need an expensive computation inside a function,
 * but only if a certain code path is hit. Instead of eagerly computing it (wasteful) or
 * manually writing `let x = null; if (!x) x = compute(); return x;` every time, `lazy()`
 * wraps that into a single callable.
 *
 * The returned function computes the value on the first call, then returns the cached
 * result on all subsequent calls. The cache lives as long as the returned function does—
 * if you create it inside a callback, it's scoped to that callback's lifetime and gets
 * garbage collected when the callback finishes.
 *
 * @example
 * ```typescript
 * // Inside an observer callback that fires per-transaction:
 * const getAllEntries = lazy(() => yarray.toArray());
 *
 * // First call: copies the array (O(n))
 * const entries = getAllEntries();
 *
 * // Second call: returns cached copy (O(1))
 * const sameEntries = getAllEntries();
 *
 * // After the callback returns, both `lazy` and the cached array
 * // are garbage collected. No manual cleanup needed.
 * ```
 *
 * @example
 * ```typescript
 * // Building a reverse-lookup map only when conflicts exist:
 * const getIndex = lazy(() => {
 *   const map = new Map<Entry, number>();
 *   for (let i = 0; i < entries.length; i++) {
 *     map.set(entries[i], i);
 *   }
 *   return map;
 * });
 *
 * // Map is never built if there are no conflicts
 * if (hasConflict) {
 *   const index = getIndex().get(existingEntry);
 * }
 * ```
 */
export function lazy<T>(init: () => T): () => T {
	let value: T | undefined;
	let initialized = false;

	return () => {
		if (!initialized) {
			value = init();
			initialized = true;
		}
		return value as T;
	};
}
