/**
 * Encryption Primitive Tests
 *
 * Verifies the workspace crypto helpers that protect encrypted storage and
 * key derivation. These tests keep the encryption format stable while proving
 * the new synchronous HKDF implementation still matches the old Web Crypto
 * contract byte for byte.
 *
 * Key behaviors:
 * - XChaCha20-Poly1305 round-trips plaintext and rejects tampering
 * - Base64 and password/salt helpers stay deterministic
 * - `deriveWorkspaceKey()` stays deterministic and Web Crypto compatible
 */

import { describe, expect, test } from 'bun:test';
import { randomBytes } from '@noble/ciphers/utils.js';
import * as Y from 'yjs';
import type { YKeyValueLwwEntry } from '../y-keyvalue/y-keyvalue-lww';
import { createEncryptedYkvLww } from '../y-keyvalue/y-keyvalue-lww-encrypted';
import {
	base64ToBytes,
	buildEncryptionKeys,
	bytesToBase64,
	decryptValue,
	deriveKeyFromPassword,
	deriveWorkspaceKey,
	type EncryptedBlob,
	encryptValue,
	generateSalt,
	getKeyVersion,
	isEncryptedBlob,
	PBKDF2_ITERATIONS_DEFAULT,
} from './index';

async function deriveWorkspaceKeyWithWebCrypto(
	userKey: Uint8Array,
	workspaceId: string,
): Promise<Uint8Array> {
	const hkdfKey = await crypto.subtle.importKey(
		'raw',
		new Uint8Array(userKey).buffer,
		'HKDF',
		false,
		['deriveBits'],
	);
	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(`workspace:${workspaceId}`),
		},
		hkdfKey,
		256,
	);
	return new Uint8Array(derivedBits);
}

describe('encryptValue / decryptValue', () => {
	test('round-trip: encrypt then decrypt returns original string', () => {
		const key = randomBytes(32);
		const plaintext = 'Hello, World!';
		const encrypted = encryptValue(plaintext, key);
		const decrypted = decryptValue(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	test('round-trip with empty string', () => {
		const key = randomBytes(32);
		const plaintext = '';
		const encrypted = encryptValue(plaintext, key);
		const decrypted = decryptValue(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	test('round-trip with unicode characters', () => {
		const key = randomBytes(32);
		const plaintext = '你好世界 🌍 مرحبا بالعالم';
		const encrypted = encryptValue(plaintext, key);
		const decrypted = decryptValue(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	test('round-trip with JSON string', () => {
		const key = randomBytes(32);
		const plaintext = JSON.stringify({ id: '123', name: 'Test', active: true });
		const encrypted = encryptValue(plaintext, key);
		const decrypted = decryptValue(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	test('round-trip with long string', () => {
		const key = randomBytes(32);
		const plaintext = 'a'.repeat(10000);
		const encrypted = encryptValue(plaintext, key);
		const decrypted = decryptValue(encrypted, key);
		expect(decrypted).toBe(plaintext);
	});

	test('each encrypt produces different ciphertext (unique nonce per call)', () => {
		const key = randomBytes(32);
		const plaintext = 'Same plaintext';
		const encrypted1 = encryptValue(plaintext, key);
		const encrypted2 = encryptValue(plaintext, key);

		// Different nonces should produce different ciphertexts
		expect(encrypted1).not.toEqual(encrypted2);

		// But both should decrypt to the same plaintext
		expect(decryptValue(encrypted1, key)).toBe(plaintext);
		expect(decryptValue(encrypted2, key)).toBe(plaintext);
	});

	test('encrypted blob is a bare Uint8Array with correct header', () => {
		const key = randomBytes(32);
		const encrypted = encryptValue('test', key);

		expect(encrypted).toBeInstanceOf(Uint8Array);
		expect(encrypted[0]).toBe(1); // format version
		expect(encrypted[1]).toBe(1); // key version (default)
		// formatVer(1) + keyVer(1) + nonce(24) + ciphertext + tag(16)
		expect(encrypted.length).toBeGreaterThanOrEqual(2 + 24 + 16);
		expect(getKeyVersion(encrypted)).toBe(1);
	});

	test('custom keyVersion is embedded at byte 1', () => {
		const key = randomBytes(32);
		const encrypted = encryptValue('test', key, undefined, 7);

		expect(encrypted[1]).toBe(7);
		expect(getKeyVersion(encrypted)).toBe(7);
	});

	test('invalid key (16-byte instead of 32) throws', () => {
		const invalidKey = new Uint8Array(16); // Wrong size
		const plaintext = 'test';

		expect(() => {
			encryptValue(plaintext, invalidKey);
		}).toThrow();
	});

	test('tampered ciphertext throws', () => {
		const key = randomBytes(32);
		const encrypted = encryptValue('test', key);

		// Copy and reverse the ciphertext portion
		const tampered = new Uint8Array(encrypted);
		for (let i = 26; i < tampered.length; i++) {
			tampered[i] = tampered[i]! ^ 0xff;
		}

		expect(() => {
			decryptValue(tampered as EncryptedBlob, key);
		}).toThrow();
	});

	test('tampered nonce throws', () => {
		const key = randomBytes(32);
		const encrypted = encryptValue('test', key);

		// Copy and flip the first nonce byte (byte 2)
		const tampered = new Uint8Array(encrypted);
		tampered[2] = tampered[2]! ^ 0xff;

		expect(() => {
			decryptValue(tampered as EncryptedBlob, key);
		}).toThrow();
	});

	test('round-trip with AAD: encrypt and decrypt with same AAD succeeds', () => {
		const key = randomBytes(32);
		const plaintext = 'Hello, World!';
		const aad = new TextEncoder().encode('workspace:123|user:456');

		const encrypted = encryptValue(plaintext, key, aad);
		const decrypted = decryptValue(encrypted, key, aad);

		expect(decrypted).toBe(plaintext);
	});

	test('mismatched AAD throws', () => {
		const key = randomBytes(32);
		const plaintext = 'Hello, World!';
		const encryptionAad = new TextEncoder().encode('workspace:123|user:456');
		const decryptionAad = new TextEncoder().encode('workspace:123|user:789');

		const encrypted = encryptValue(plaintext, key, encryptionAad);

		expect(() => {
			decryptValue(encrypted, key, decryptionAad);
		}).toThrow();
	});

	test('encrypt with AAD, decrypt without AAD throws', () => {
		const key = randomBytes(32);
		const plaintext = 'Hello, World!';
		const aad = new TextEncoder().encode('workspace:123|user:456');

		const encrypted = encryptValue(plaintext, key, aad);

		expect(() => {
			decryptValue(encrypted, key);
		}).toThrow();
	});

	test('encrypt without AAD, decrypt with AAD throws', () => {
		const key = randomBytes(32);
		const plaintext = 'Hello, World!';
		const aad = new TextEncoder().encode('workspace:123|user:456');

		const encrypted = encryptValue(plaintext, key);

		expect(() => {
			decryptValue(encrypted, key, aad);
		}).toThrow();
	});
});

describe('isEncryptedBlob', () => {
	test('returns true for valid EncryptedBlob', () => {
		const key = randomBytes(32);
		const blob = encryptValue('test', key);
		expect(isEncryptedBlob(blob)).toBe(true);
	});

	test('returns false for null', () => {
		expect(isEncryptedBlob(null)).toBe(false);
	});

	test('returns false for undefined', () => {
		expect(isEncryptedBlob(undefined)).toBe(false);
	});

	test('returns false for string', () => {
		expect(isEncryptedBlob('not a blob')).toBe(false);
	});

	test('returns false for number', () => {
		expect(isEncryptedBlob(42)).toBe(false);
	});

	test('returns false for plain object', () => {
		expect(isEncryptedBlob({})).toBe(false);
	});

	test('returns true for Uint8Array at or above minimum blob size (42 bytes)', () => {
		// Minimum: 2 header + 24 nonce + 16 tag = 42 bytes
		expect(isEncryptedBlob(new Uint8Array(42))).toBe(true);
		expect(isEncryptedBlob(new Uint8Array(100))).toBe(true);
	});

	test('returns false for Uint8Array below minimum blob size', () => {
		expect(isEncryptedBlob(new Uint8Array([1]))).toBe(false);
		expect(isEncryptedBlob(new Uint8Array([1, 0, 0, 0]))).toBe(false);
		expect(isEncryptedBlob(new Uint8Array(41))).toBe(false);
	});

	test('returns false for empty Uint8Array', () => {
		expect(isEncryptedBlob(new Uint8Array([]))).toBe(false);
	});

	test('returns false for old object format { v: 1, ct: Uint8Array }', () => {
		// The old wrapper format is no longer recognized
		expect(isEncryptedBlob({ v: 1, ct: new Uint8Array(42) })).toBe(false);
	});

	test('returns false for regular arrays and objects with extra keys', () => {
		expect(isEncryptedBlob([1, 2, 3])).toBe(false);
		expect(isEncryptedBlob({ id: '1', _v: 1, data: 'test' })).toBe(false);
	});
});

describe('base64 helpers', () => {
	test('round-trip: bytesToBase64 then base64ToBytes returns original', () => {
		const original = new Uint8Array([1, 2, 3, 255, 0, 127, 128]);
		const base64 = bytesToBase64(original);
		const decoded = base64ToBytes(base64);

		expect(decoded).toEqual(original);
	});

	test('handles empty Uint8Array', () => {
		const original = new Uint8Array([]);
		const base64 = bytesToBase64(original);
		const decoded = base64ToBytes(base64);

		expect(decoded).toEqual(original);
		expect(decoded.length).toBe(0);
	});

	test('handles byte value 0', () => {
		const original = new Uint8Array([0, 0, 0]);
		const base64 = bytesToBase64(original);
		const decoded = base64ToBytes(base64);

		expect(decoded).toEqual(original);
	});

	test('handles byte value 255', () => {
		const original = new Uint8Array([255, 255, 255]);
		const base64 = bytesToBase64(original);
		const decoded = base64ToBytes(base64);

		expect(decoded).toEqual(original);
	});

	test('handles all byte values 0-255', () => {
		const original = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			original[i] = i;
		}

		const base64 = bytesToBase64(original);
		const decoded = base64ToBytes(base64);

		expect(decoded).toEqual(original);
	});

	test('bytesToBase64 produces valid base64 string', () => {
		const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
		const base64 = bytesToBase64(bytes);

		// Valid base64 should only contain alphanumeric, +, /, and = for padding
		expect(/^[A-Za-z0-9+/]*={0,2}$/.test(base64)).toBe(true);
	});

	test('base64ToBytes handles standard base64 strings', () => {
		const base64 = 'SGVsbG8gV29ybGQ='; // "Hello World"
		const decoded = base64ToBytes(base64);
		const text = new TextDecoder().decode(decoded);

		expect(text).toBe('Hello World');
	});
});

describe('binary storage overhead', () => {
	test('binary ct produces smaller Y.Doc than base64 string ct', () => {
		const key = randomBytes(32);
		const testValues = [
			'short',
			'a'.repeat(100),
			'a'.repeat(500),
			JSON.stringify({ id: '123', name: 'Test User', active: true }),
		];

		// Create Y.Doc with binary blobs (current format)
		const binaryDoc = new Y.Doc({ guid: 'bench-binary' });
		const binaryArray =
			binaryDoc.getArray<YKeyValueLwwEntry<EncryptedBlob | string>>('data');
		const binaryKv = createEncryptedYkvLww<string>(
			binaryArray,
			new Map([[1, key]]),
		);

		for (const [i, val] of testValues.entries()) {
			binaryKv.set(`key-${i}`, val);
		}

		// Create Y.Doc with base64 string blobs (simulated old format)
		const base64Doc = new Y.Doc({ guid: 'bench-base64' });
		const base64Array = base64Doc.getArray<YKeyValueLwwEntry<string>>('data');

		// Extract binary entries and convert to base64 string representation
		const binaryEntries = binaryArray.toArray();
		const base64Entries: YKeyValueLwwEntry<string>[] = binaryEntries.map(
			(entry) => {
				const val = entry.val;
				if (isEncryptedBlob(val)) {
					return {
						...entry,
						val: bytesToBase64(val),
					};
				}
				return entry as YKeyValueLwwEntry<string>;
			},
		);
		base64Array.push(base64Entries);
		base64Array.push(base64Entries);

		const base64Size = Y.encodeStateAsUpdate(base64Doc).byteLength;
		const binarySize = Y.encodeStateAsUpdate(binaryDoc).byteLength;

		// Binary should be smaller than base64
		expect(binarySize).toBeLessThan(base64Size);

		const savings = ((1 - binarySize / base64Size) * 100).toFixed(1);
		console.log(
			`base64 size: ${base64Size} bytes, binary size: ${binarySize} bytes, savings: ${savings}%`,
		);
	});
});

describe('deriveWorkspaceKey', () => {
	test('same inputs produce same key (deterministic)', () => {
		const userKey = randomBytes(32);
		const workspaceId = 'tab-manager';

		const key1 = deriveWorkspaceKey(userKey, workspaceId);
		const key2 = deriveWorkspaceKey(userKey, workspaceId);

		expect(key1).toEqual(key2);
	});

	test('different userKeys produce different workspace keys', () => {
		const userKey1 = randomBytes(32);
		const userKey2 = randomBytes(32);
		const workspaceId = 'tab-manager';

		const key1 = deriveWorkspaceKey(userKey1, workspaceId);
		const key2 = deriveWorkspaceKey(userKey2, workspaceId);

		expect(key1).not.toEqual(key2);
	});

	test('different workspaceIds produce different keys', () => {
		const userKey = randomBytes(32);

		const key1 = deriveWorkspaceKey(userKey, 'tab-manager');
		const key2 = deriveWorkspaceKey(userKey, 'whispering');

		expect(key1).not.toEqual(key2);
	});

	test('output is 32 bytes', () => {
		const userKey = randomBytes(32);
		const key = deriveWorkspaceKey(userKey, 'tab-manager');

		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(32);
	});

	test('matches the previous Web Crypto HKDF output for fixed fixtures', async () => {
		const fixtures = [
			{
				userKey: base64ToBytes('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='),
				workspaceId: 'tab-manager',
			},
			{
				userKey: base64ToBytes('8PHy8/T19vf4+fr7/P3+/wABAgMEBQYHCAkKCwwNDg8='),
				workspaceId: 'workspace:with:colons',
			},
		];

		for (const fixture of fixtures) {
			const syncKey = deriveWorkspaceKey(fixture.userKey, fixture.workspaceId);
			const webCryptoKey = await deriveWorkspaceKeyWithWebCrypto(
				fixture.userKey,
				fixture.workspaceId,
			);

			expect(syncKey).toEqual(webCryptoKey);
		}
	});
});

describe('deriveKeyFromPassword', () => {
	test('same inputs produce same key (deterministic)', () => {
		const salt = randomBytes(32);
		const key1 = deriveKeyFromPassword('hunter2', salt);
		const key2 = deriveKeyFromPassword('hunter2', salt);
		expect(key1).toEqual(key2);
	});

	test('different passwords produce different keys', () => {
		const salt = randomBytes(32);
		const key1 = deriveKeyFromPassword('password1', salt);
		const key2 = deriveKeyFromPassword('password2', salt);
		expect(key1).not.toEqual(key2);
	});

	test('different salts produce different keys', () => {
		const salt1 = randomBytes(32);
		const salt2 = randomBytes(32);
		const key1 = deriveKeyFromPassword('hunter2', salt1);
		const key2 = deriveKeyFromPassword('hunter2', salt2);
		expect(key1).not.toEqual(key2);
	});

	test('output is 32 bytes', () => {
		const salt = randomBytes(32);
		const key = deriveKeyFromPassword('hunter2', salt);
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(32);
	});

	test('default iterations is 600,000', () => {
		expect(PBKDF2_ITERATIONS_DEFAULT).toBe(600_000);
		// Omitting iterations param still works
		const salt = randomBytes(32);
		const key = deriveKeyFromPassword('hunter2', salt);
		expect(key.length).toBe(32);
	});

	test('integrates with deriveWorkspaceKey', () => {
		const salt = randomBytes(32);
		const userKey = deriveKeyFromPassword('hunter2', salt);
		const wsKey = deriveWorkspaceKey(userKey, 'epicenter.redact');
		expect(wsKey).toBeInstanceOf(Uint8Array);
		expect(wsKey.length).toBe(32);
		// Deterministic: same derivation produces same workspace key
		const wsKey2 = deriveWorkspaceKey(userKey, 'epicenter.redact');
		expect(wsKey).toEqual(wsKey2);
	});
});

describe('generateSalt', () => {
	test('output is 32 bytes', () => {
		const salt = generateSalt();
		expect(salt).toBeInstanceOf(Uint8Array);
		expect(salt.length).toBe(32);
	});

	test('two calls produce different salts', () => {
		const salt1 = generateSalt();
		const salt2 = generateSalt();
		expect(salt1).not.toEqual(salt2);
	});
});

describe('buildEncryptionKeys', () => {
	test('returns array with one entry matching shape', () => {
		const userKey = randomBytes(32);
		const keys = buildEncryptionKeys(userKey);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toHaveProperty('version');
		expect(keys[0]).toHaveProperty('userKeyBase64');
	});

	test('default version is 1', () => {
		const userKey = randomBytes(32);
		const keys = buildEncryptionKeys(userKey);
		expect(keys[0]!.version).toBe(1);
	});

	test('custom version is respected', () => {
		const userKey = randomBytes(32);
		const keys = buildEncryptionKeys(userKey, 3);
		expect(keys[0]!.version).toBe(3);
	});

	test('userKeyBase64 round-trips through base64ToBytes', () => {
		const userKey = randomBytes(32);
		const keys = buildEncryptionKeys(userKey);
		const decoded = base64ToBytes(keys[0]!.userKeyBase64);
		expect(decoded).toEqual(userKey);
	});

	test('end-to-end: deriveKeyFromPassword → buildEncryptionKeys → encrypt/decrypt', () => {
		const salt = generateSalt();
		const userKey = deriveKeyFromPassword('hunter2', salt);
		const keys = buildEncryptionKeys(userKey);

		// Decode the base64 user key and derive a workspace key
		const decodedUserKey = base64ToBytes(keys[0]!.userKeyBase64);
		const wsKey = deriveWorkspaceKey(decodedUserKey, 'epicenter.vault');

		// Use the workspace key to encrypt and decrypt
		const plaintext = 'secret vault data';
		const encrypted = encryptValue(plaintext, wsKey);
		const decrypted = decryptValue(encrypted, wsKey);
		expect(decrypted).toBe(plaintext);
	});
});
