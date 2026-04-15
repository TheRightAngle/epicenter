/**
 * ArkType schema for versioned encryption keys in transit.
 *
 * This is the **source of truth** for the `EncryptionKey` shape. The TypeScript
 * type is derived from the schema via `typeof EncryptionKey.infer`, so runtime
 * validation and static types are always in sync.
 *
 * Used by:
 * - Session response (`encryptionKeys` field)
 * - `workspace.applyEncryptionKeys(keys)` — public API
 * - Auth session cache deserialization (runtime validation)
 * @module
 */
import { type } from 'arktype';

/**
 * A single versioned encryption key for transport.
 *
 * Pairs a key version (from the server's `ENCRYPTION_SECRETS`) with the
 * HKDF-derived per-user key encoded as base64 for JSON transport.
 */
export const EncryptionKey = type({
	version: 'number.integer > 0',
	userKeyBase64: 'string',
});

/**
 * Non-empty array of versioned encryption keys.
 *
 * Guarantees at least one key is present. The highest-version entry is the
 * current key for new encryptions; older entries exist for decrypting blobs
 * encrypted with previous key versions.
 */
export const EncryptionKeys = type([
	EncryptionKey,
	'...',
	EncryptionKey.array(),
]);
export type EncryptionKey = typeof EncryptionKey.infer;
export type EncryptionKeys = typeof EncryptionKeys.infer;

/**
 * Canonical fingerprint for a set of encryption keys.
 *
 * Produces a deterministic string from an `EncryptionKeys` array by sorting
 * entries by version ascending and joining as `version:base64` pairs. This
 * mirrors the `ENCRYPTION_SECRETS` wire format (`1:secret,2:secret`).
 *
 * Used by `applyEncryptionKeys()` for same-key dedup — if the fingerprint
 * hasn't changed since the last call, the expensive derivation + activation
 * is skipped entirely.
 *
 * @example
 * ```typescript
 * const keys: EncryptionKeys = [
 *   { version: 2, userKeyBase64: 'newKey==' },
 *   { version: 1, userKeyBase64: 'oldKey==' },
 * ];
 * encryptionKeysFingerprint(keys);
 * // => '1:oldKey==,2:newKey=='
 * ```
 */
export function encryptionKeysFingerprint(keys: EncryptionKeys): string {
	return [...keys]
		.sort((a, b) => a.version - b.version)
		.map((k) => `${k.version}:${k.userKeyBase64}`)
		.join(',');
}
