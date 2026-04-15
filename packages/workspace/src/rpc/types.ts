import type { Static, TSchema } from 'typebox';
import type { Action } from '../shared/actions.js';

/**
 * Flattens a nested actions tree into a flat map of dot-path string keys
 * to `{ input, output }` pairs.
 *
 * This is the core type utility for end-to-end typed RPC. The caller imports
 * the target's action type and passes it to `InferRpcMap` to get a flat map
 * that `rpc<TMap>()` can use for autocomplete and type checking.
 *
 * @example
 * ```typescript
 * // Tab-manager exports its actions type:
 * export type TabManagerRpc = InferRpcMap<typeof workspace.actions>;
 * // Resolves to:
 * // {
 * //   'tabs.close': { input: { tabIds: number[] }; output: { closedCount: number } }
 * //   'tabs.list':  { input: undefined; output: { tabs: Tab[] } }
 * // }
 *
 * // CLI imports it for typed RPC:
 * import type { TabManagerRpc } from '@epicenter/tab-manager/rpc';
 * const { data } = await rpc<TabManagerRpc>(peer, 'tabs.close', { tabIds: [1] });
 * //                                              ^^^^^^^^^^^^ autocomplete
 * //                                                            ^^^^^^^^^^^^^ type-checked
 * // data is { closedCount: number } | null
 * ```
 */
export type InferRpcMap<TActions> = FlattenToIntersection<
	FlattenActions<TActions>
>;

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Walk the actions tree. For each leaf (Action), emit a Record<dotPath, { input, output }>.
 * For each branch (nested object), recurse with the key appended to the prefix.
 * Returns a union of single-key Records.
 */
type FlattenActions<TActions, TPrefix extends string = ''> = {
	[K in keyof TActions & string]: TActions[K] extends Action<
		infer TInput,
		infer TOutput
	>
		? Record<
				`${TPrefix}${K}`,
				{
					input: TInput extends TSchema ? Static<TInput> : undefined;
					output: Awaited<TOutput>;
				}
			>
		: FlattenActions<TActions[K], `${TPrefix}${K}.`>;
}[keyof TActions & string];

/** Collapse a union of Records into a single flat Record. */
type FlattenToIntersection<TUnion> = (
	TUnion extends unknown
		? (k: TUnion) => void
		: never
) extends (k: infer TIntersection) => void
	? { [K in keyof TIntersection]: TIntersection[K] }
	: never;

/**
 * Default RPC action map when no type parameter is provided.
 * Accepts any string action with unknown input/output.
 */
export type DefaultRpcMap = Record<string, { input: unknown; output: unknown }>;

/**
 * Constraint for the TMap generic parameter on `rpc()`.
 *
 * Uses `any` (not `unknown`) for input/output because generic constraints
 * need covariant compatibility — `{ input: string }` must extend
 * `{ input: any }` but does NOT extend `{ input: unknown }`.
 */
export type RpcActionMap = Record<string, { input: any; output: any }>;
