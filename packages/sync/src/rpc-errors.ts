import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';

/**
 * RPC error variants for remote action invocation over the sync protocol.
 *
 * These errors cover all failure modes in the RPC flow:
 * - Infrastructure errors (PeerOffline, Timeout) from the transport layer
 * - Application errors (ActionNotFound, ActionFailed) from the target peer
 *
 * Defined in `@epicenter/sync` because they describe wire-protocol failure
 * modes—both the server (Durable Object) and client construct these errors
 * at the sync boundary.
 *
 * All errors include a `name` discriminant for switch-based handling:
 *
 * @example
 * ```typescript
 * const { data, error } = await workspace.extensions.sync.rpc(clientId, 'tabs.close', { tabIds: [1] });
 * if (error) {
 *   switch (error.name) {
 *     case 'PeerOffline': // target not connected
 *     case 'Timeout':     // no response in time
 *     case 'ActionNotFound': // bad action path
 *     case 'ActionFailed':   // handler error
 *   }
 * }
 * ```
 */
export const RpcError = defineErrors({
	PeerOffline: () => ({
		message: 'Target peer is not connected',
	}),
	Timeout: ({ ms }: { ms: number }) => ({
		message: `RPC call timed out after ${ms}ms`,
		ms,
	}),
	ActionNotFound: ({ action }: { action: string }) => ({
		message: `Target has no handler for '${action}'`,
		action,
	}),
	ActionFailed: ({ action, cause }: { action: string; cause: unknown }) => ({
		message: `Action '${action}' failed: ${extractErrorMessage(cause)}`,
		action,
		cause,
	}),
	Disconnected: () => ({
		message: 'Connection lost before RPC response arrived',
	}),
});
export type RpcError = InferErrors<typeof RpcError>;

const RPC_ERROR_NAMES = new Set<string>([
	'PeerOffline',
	'Timeout',
	'ActionNotFound',
	'ActionFailed',
	'Disconnected',
]);

/**
 * Type guard that narrows an unknown wire value to a known {@link RpcError} variant.
 *
 * Use this at the deserialization boundary instead of `as RpcError` casts.
 * Validates that the value is an object with a `name` field matching one of
 * the known RPC error variant names.
 *
 * @example
 * ```typescript
 * if (isRpcError(result.error)) {
 *   switch (result.error.name) {
 *     case 'PeerOffline': // TypeScript knows the full shape
 *     case 'Timeout':     // No cast needed
 *   }
 * }
 * ```
 */
export function isRpcError(value: unknown): value is RpcError {
	return (
		value != null &&
		typeof value === 'object' &&
		'name' in value &&
		typeof value.name === 'string' &&
		RPC_ERROR_NAMES.has(value.name)
	);
}
