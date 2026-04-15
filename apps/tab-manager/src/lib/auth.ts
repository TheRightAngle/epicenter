/**
 * Auth state for the tab manager Chrome extension.
 *
 * Exports the persisted session and Google credentials helper. The actual
 * `auth` (createAuth) lives in the workspace client where
 * `onLogin`/`onLogout` can wire workspace unlock and sync reconnect.
 *
 * @see {@link ./client} — auth with onLogin/onLogout
 * @see {@link ./state/storage-state.svelte} — chrome.storage reactive wrapper
 */

import { AuthSession } from '@epicenter/svelte/auth';
import { createStorageState } from './state/storage-state.svelte';

const GOOGLE_CLIENT_ID =
	'702083743841-820rm0nhf9kslmvqcikecgkmku5agbbi.apps.googleusercontent.com';

/** Persisted auth snapshot in `chrome.storage.local`. */
export const session = createStorageState('local:authSession', {
	fallback: null,
	schema: AuthSession.or('null'),
});

export async function getGoogleCredentials(): Promise<{
	idToken: string;
	nonce: string;
}> {
	const redirectUri = browser.identity.getRedirectURL();
	const nonce = crypto.randomUUID();
	const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'id_token');
	authUrl.searchParams.set('scope', 'openid email profile');
	authUrl.searchParams.set('nonce', nonce);

	const responseUrl = await browser.identity.launchWebAuthFlow({
		url: authUrl.toString(),
		interactive: true,
	});
	if (!responseUrl) throw new Error('No response from Google');

	const fragment = new URL(responseUrl).hash.substring(1);
	const params = new URLSearchParams(fragment);
	const idToken = params.get('id_token');
	if (!idToken) throw new Error('No id_token in response');

	return { idToken, nonce };
}
