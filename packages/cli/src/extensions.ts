/**
 * Pre-built workspace extension factories for CLI-backed configs.
 *
 * The CLI has no interactive auth system (no `createAuth` with `onLogin`).
 * Instead, credentials are stored on disk by `epicenter auth login` and
 * loaded eagerly during workspace initialization. `createCliUnlock` is the
 * CLI equivalent of the browser's `onLogin → applyEncryptionKeys` pattern.
 */

import type { createSessionStore } from './auth/store.js';

type SessionStore = ReturnType<typeof createSessionStore>;

/**
 * Create an encryption unlock extension that loads keys from the CLI session store.
 *
 * Waits for all prior extensions to initialize, then loads the session for
 * the given server URL and applies encryption keys if present. Register with
 * `.withWorkspaceExtension('unlock', ...)`.
 *
 * @param sessions - Session store created by `createSessionStore()`
 * @param serverUrl - Server URL to load the session for
 *
 * @example
 * ```typescript
 * import { createSessionStore, resolveEpicenterHome, createCliUnlock } from '@epicenter/cli';
 *
 * const sessions = createSessionStore(resolveEpicenterHome());
 *
 * const workspace = createWorkspace(definition)
 *   .withWorkspaceExtension('unlock', createCliUnlock(sessions, SERVER_URL));
 * ```
 */
export function createCliUnlock(sessions: SessionStore, serverUrl: string) {
	return ({
		whenReady,
		applyEncryptionKeys,
	}: {
		whenReady: Promise<void>;
		applyEncryptionKeys: (
			keys: [{ version: number; userKeyBase64: string }, ...{ version: number; userKeyBase64: string }[]],
		) => void;
	}) => ({
		whenReady: (async () => {
			await whenReady;
			const session = await sessions.load(serverUrl);
			if (session?.encryptionKeys) {
				applyEncryptionKeys(session.encryptionKeys);
			}
		})(),
	});
}
