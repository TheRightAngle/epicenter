/**
 * Auth session store backed by `$EPICENTER_HOME/auth/sessions.json`.
 *
 * Sessions are keyed by canonical server URL. All URL variants (`wss://`,
 * `https://`, trailing slashes) normalize to the same key automatically.
 *
 * @example
 * ```typescript
 * const sessions = createSessionStore(home);
 *
 * await sessions.save('https://api.epicenter.so', tokenData, sessionData);
 * const s = await sessions.load('https://api.epicenter.so');
 * ```
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionResponse } from '@epicenter/api/types';

/**
 * A persisted auth session for a single server.
 *
 * The server URL is not stored here—it's the map key in the session store.
 */
export type AuthSession = {
	/** Bearer token for API/WebSocket auth. */
	accessToken: string;
	/** Unix ms when the session expires. */
	expiresAt: number;
	/** Versioned encryption keys for workspace decryption. */
	encryptionKeys: SessionResponse['encryptionKeys'];
	/** User info snapshot from the auth flow. */
	user?: { id: string; email: string; name?: string };
};

/**
 * Canonicalize a server URL to its HTTPS form.
 *
 * - `wss://API.epicenter.so/` → `https://api.epicenter.so`
 * - `ws://localhost:3913` → `http://localhost:3913`
 * - `https://api.epicenter.so/` → `https://api.epicenter.so`
 */
function normalizeUrl(url: string): string {
	return url
		.replace(/^wss:/, 'https:')
		.replace(/^ws:/, 'http:')
		.replace(/\/+$/, '')
		.toLowerCase();
}

/**
 * Create a session store bound to a home directory.
 *
 * All methods normalize server URLs internally—callers never need
 * to think about URL canonicalization.
 *
 * @example
 * ```typescript
 * const sessions = createSessionStore('~/.epicenter');
 *
 * await sessions.save('https://api.epicenter.so', tokenData, sessionData);
 *
 * // Load by server
 * const session = await sessions.load('https://api.epicenter.so');
 *
 * // Load most recent (when no --server flag)
 * const latest = await sessions.loadDefault();
 *
 * // Clear on logout
 * await sessions.clear('https://api.epicenter.so');
 * ```
 */
export function createSessionStore(home: string) {
	const path = join(home, 'auth', 'sessions.json');

	type Store = Record<string, AuthSession>;

	async function read(): Promise<Store> {
		const file = Bun.file(path);
		if (!(await file.exists())) return {};
		try {
			return (await file.json()) as Store;
		} catch {
			return {};
		}
	}

	async function write(store: Store): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(path, JSON.stringify(store, null, '\t'));
	}

	return {
		/**
		 * Save a session from a successful login flow.
		 *
		 * Maps the raw API responses (token grant + session info) into the
		 * persisted `AuthSession` format. Callers pass through the API types
		 * directly—no manual field picking needed.
		 *
		 * The server URL is normalized before storage so that `wss://host`,
		 * `https://host`, and `https://host/` all map to the same entry.
		 * Existing entries are deleted before reinsertion so the most recently
		 * saved session stays at the end of JS object insertion order for
		 * `loadDefault()`.
		 */
		async save(
			server: string,
			token: { access_token: string; expires_in: number },
			sessionData: SessionResponse,
		): Promise<void> {
			const store = await read();
			const key = normalizeUrl(server);
			delete store[key];
			store[key] = {
				accessToken: token.access_token,
				expiresAt: Date.now() + token.expires_in * 1000,
				encryptionKeys: sessionData.encryptionKeys,
				user: sessionData.user,
			};
			await write(store);
		},

		/**
		 * Load the session for a specific server.
		 *
		 * @returns The stored session, or `null` if none exists.
		 */
		async load(
			server: string,
		): Promise<(AuthSession & { server: string }) | null> {
			const store = await read();
			const key = normalizeUrl(server);
			const session = store[key];
			return session ? { ...session, server: key } : null;
		},

		/**
		 * Load the most recently saved session (any server).
		 *
		 * Returns the most recently saved session by reading the last entry in
		 * the persisted object. This relies on ES2015+ object insertion order for
		 * non-integer string keys, which is preserved across
		 * `JSON.stringify()`/`JSON.parse()` round-trips. `save()` deletes an
		 * existing server key before reinserting it so the newest session is
		 * always the last entry.
		 *
		 * @returns The most recent session with its server URL, or `null` if empty.
		 */
		async loadDefault(): Promise<(AuthSession & { server: string }) | null> {
			const store = await read();
			const entries = Object.entries(store);
			if (entries.length === 0) return null;
			const lastEntry = entries[entries.length - 1];
			if (!lastEntry) return null;
			const [server, session] = lastEntry;
			return { ...session, server };
		},

		/**
		 * Delete the session for a specific server.
		 */
		async clear(server: string): Promise<void> {
			const store = await read();
			delete store[normalizeUrl(server)];
			await write(store);
		},
	};
}
