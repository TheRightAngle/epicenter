import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { trySync } from 'wellcrafted/result';

// ── Error types ──────────────────────────────────────────────────────────────

export const PersistedError = defineErrors({
	JsonParseFailed: ({
		key,
		raw,
		cause,
	}: {
		key: string;
		raw: string;
		cause: unknown;
	}) => ({
		message: `Failed to parse stored value for "${key}": ${extractErrorMessage(cause)}`,
		key,
		raw,
		cause,
	}),
	SchemaValidationFailed: ({
		key,
		value,
		issues,
	}: {
		key: string;
		value: unknown;
		issues: ReadonlyArray<StandardSchemaV1.Issue>;
	}) => ({
		message: `Schema validation failed for stored value at "${key}"`,
		key,
		value,
		issues,
	}),
});
export type PersistedError = InferErrors<typeof PersistedError>;

// ── createPersistedState ─────────────────────────────────────────────────────

type PersistedStateOptions<TSchema extends StandardSchemaV1> = {
	/** The localStorage (or sessionStorage) key. */
	key: string;
	/** Schema used to validate values read from storage. */
	schema: TSchema;
	/**
	 * Fallback value used when storage is empty or validation fails.
	 * Also used as the initial value on first visit.
	 */
	defaultValue: NoInfer<StandardSchemaV1.InferOutput<TSchema>>;
	/**
	 * The Web Storage instance to use.
	 * @default window.localStorage
	 */
	storage?: Storage;
	/**
	 * Whether to sync state across tabs via the `storage` event.
	 * @default true
	 */
	syncTabs?: boolean;
	/**
	 * Called when a value read from storage fails to parse or validate.
	 * Fire-and-forget — `defaultValue` is used as the fallback regardless.
	 */
	onError?: (error: PersistedError) => void;
	/**
	 * Called when writing to storage fails (e.g., quota exceeded).
	 */
	onUpdateError?: (error: unknown) => void;
};

/**
 * Create reactive persisted state backed by Web Storage with schema validation.
 *
 * Returns an object with a `.current` accessor (following Svelte 5 / runed conventions)
 * Values are validated against a StandardSchemaV1 schema on every read from storage.
 * Cross-tab sync via `storage` event, same-tab sync via `focus` event.
 *
 * @example
 * ```ts
 * import { createPersistedState } from '@epicenter/svelte';
 * import { type } from 'arktype';
 *
 * const theme = createPersistedState({
 *   key: 'app-theme',
 *   schema: type("'light' | 'dark'"),
 *   defaultValue: 'dark',
 * });
 *
 * theme.current;           // 'dark' (reactive)
 * theme.current = 'light';  // persists to localStorage
 *
 * // Imperative read (sync — localStorage is immediate):
 * const value = theme.get();
 * ```
 */
export function createPersistedState<TSchema extends StandardSchemaV1>({
	key,
	schema,
	defaultValue,
	storage: storageApi = window.localStorage,
	syncTabs = true,
	onError,
	onUpdateError,
}: PersistedStateOptions<TSchema>) {
	function parseRawValue(raw: string | null) {
		if (raw === null) return defaultValue;

		const { data: parsed, error: jsonError } = trySync({
			try: () => JSON.parse(raw) as unknown,
			catch: (cause) => PersistedError.JsonParseFailed({ key, raw, cause }),
		});
		if (jsonError) {
			onError?.(jsonError);
			return defaultValue;
		}

		const result = schema['~standard'].validate(parsed);
		if (result instanceof Promise) {
			onError?.(
				PersistedError.SchemaValidationFailed({
					key,
					value: parsed,
					issues: [
						{
							message:
								'Schema returned async result during synchronous validation',
						},
					],
				}).error,
			);
			return defaultValue;
		}

		if (result.issues) {
			onError?.(
				PersistedError.SchemaValidationFailed({
					key,
					value: parsed,
					issues: result.issues,
				}).error,
			);
			return defaultValue;
		}

		return result.value as StandardSchemaV1.InferOutput<TSchema>;
	}

	function readFromStorage() {
		return parseRawValue(storageApi.getItem(key));
	}

	let value = $state(readFromStorage());
	const listeners = new Set<
		(value: StandardSchemaV1.InferOutput<TSchema>) => void
	>();

	function setValue(nextValue: StandardSchemaV1.InferOutput<TSchema>) {
		if (Object.is(value, nextValue)) return;
		value = nextValue;
		for (const listener of listeners) {
			listener(nextValue);
		}
	}

	// Cross-tab sync: `storage` event fires when ANOTHER tab writes to localStorage.
	// sessionStorage doesn't fire cross-tab events, so enabling this is harmless.
	if (syncTabs) {
		window.addEventListener('storage', (e) => {
			if (e.key !== key) return;
			setValue(parseRawValue(e.newValue));
		});
	}

	// Same-tab sync: catches DevTools edits and writes from other libraries.
	window.addEventListener('focus', () => {
		setValue(readFromStorage());
	});

	return {
		/**
		 * Reactive value for Svelte template bindings and `$derived` blocks.
		 *
		 * For localStorage-backed stores this is always the real value—localStorage
		 * is synchronous, so `.current` is accurate at import time. Use `.get()`
		 * in imperative code (boot scripts, closures) for API parity with async stores.
		 */
		get current() {
			return value;
		},
		set current(newValue: StandardSchemaV1.InferOutput<TSchema>) {
			setValue(newValue);
			try {
				storageApi.setItem(key, JSON.stringify(newValue));
			} catch (error) {
				onUpdateError?.(error);
			}
		},
		/**
		 * Authoritative read—returns the current value synchronously.
		 *
		 * localStorage is synchronous, so this is always the real value.
		 * Use this in imperative code (boot scripts, closures, event handlers)
		 * where you want to be explicit about reading the persisted value.
		 *
		 * @example
		 * ```typescript
		 * const cached = session.get();
		 * if (cached) {
		 *   console.log('Cached session:', cached.token);
		 * }
		 * ```
		 */
		get(): StandardSchemaV1.InferOutput<TSchema> {
			return value;
		},
		watch(listener: (value: StandardSchemaV1.InferOutput<TSchema>) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
