/**
 * Typed API client for Epicenter auth endpoints.
 *
 * Factory function that takes a server URL and optional bearer token,
 * returns typed methods for every auth endpoint. Centralizes:
 * - Endpoint paths (all under `/auth/*` matching app.ts basePath)
 * - Request/response types
 * - Error handling and JSON parsing
 *
 * @example
 * ```typescript
 * // Unauthenticated (login flows)
 * const api = createAuthApi('https://api.epicenter.so');
 * const { token, user } = await api.signInWithEmail('me@example.com', 'pw');
 *
 * // Authenticated (session operations)
 * const authed = createAuthApi('https://api.epicenter.so', token);
 * const session = await authed.getSession();
 * ```
 */

const CLIENT_ID = 'epicenter-cli';

// ─── Response types ──────────────────────────────────────────────────────────

/** Derived from Better Auth's `$Infer` — always matches the actual API response. */
import type { SessionResponse } from '@epicenter/api/types';

/**
 * Response from `/auth/sign-in/email` with the bearer plugin active.
 *
 * The `token` field is added by the `bearer()` plugin and isn't
 * reflected in Better Auth's `$Infer` types, so this is partially hand-written.
 */
export type SignInResponse = {
	token: string;
	expiresAt: string;
	user: SessionResponse['user'];
};

export type DeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
};

export type DeviceTokenResponse =
	| { access_token: string; expires_in: number; error?: undefined }
	| { error: string; error_description?: string };

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a typed API client for Epicenter auth endpoints.
 *
 * All paths are relative to the server's Better Auth `basePath: '/auth'`
 * as configured in `apps/api/src/auth/create-auth.ts`.
 *
 * @param serverUrl - Base URL of the Epicenter server (e.g. `https://api.epicenter.so`).
 * @param token - Optional bearer token for authenticated requests.
 */
export function createAuthApi(serverUrl: string, token?: string) {
	async function request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const headers: Record<string, string> = {};
		if (token) headers.authorization = `Bearer ${token}`;
		if (body !== undefined) headers['content-type'] = 'application/json';

		const res = await fetch(`${serverUrl}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});

		const text = await res.text();

		if (!res.ok) {
			throw new Error(
				`${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
			);
		}

		if (!text) {
			throw new Error(`${method} ${path}: empty response body`);
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(
				`${method} ${path}: invalid JSON response: ${text.slice(0, 200)}`,
			);
		}
	}

	return {
		// ── Password auth ──────────────────────────────────────────────────

		/**
		 * Sign in with email and password.
		 *
		 * @returns Session token and user info.
		 */
		signInWithEmail(email: string, password: string) {
			return request<SignInResponse>('POST', '/auth/sign-in/email', {
				email,
				password,
			});
		},

		/**
		 * Sign out the current session.
		 *
		 * Best-effort — the server may be unreachable. Does not parse
		 * the response body (sign-out returns no JSON).
		 */
		async signOut() {
			const headers: Record<string, string> = {};
			if (token) headers.authorization = `Bearer ${token}`;
			await fetch(`${serverUrl}/auth/sign-out`, { method: 'POST', headers });
		},

		// ── Session ────────────────────────────────────────────────────────

		/**
		 * Get the current session and user info.
		 *
		 * Requires a bearer token (set via constructor or the `bearer()` plugin).
		 * Returns user profile and session expiry.
		 */
		getSession() {
			return request<SessionResponse>('GET', '/auth/get-session');
		},

		// ── Device code flow (RFC 8628) ────────────────────────────────────

		/**
		 * Request a device code for the OAuth device authorization flow.
		 *
		 * The user visits the returned `verification_uri_complete` in a browser
		 * and approves the device. The CLI then polls `pollDeviceToken` until
		 * the authorization completes.
		 */
		async requestDeviceCode() {
			const data = await request<
				DeviceCodeResponse & { error?: string; error_description?: string }
			>('POST', '/auth/device/code', { client_id: CLIENT_ID });

			if ('error' in data && data.error) {
				throw new Error(
					data.error_description ?? `Device code request failed: ${data.error}`,
				);
			}
			return data as DeviceCodeResponse;
		},

		/**
		 * Poll the token endpoint with a previously-issued device code.
		 *
		 * This endpoint cannot use the generic `request()` helper above.
		 * RFC 8628 device authorization uses 400 responses with structured JSON
		 * error payloads like `authorization_pending` and `slow_down` as normal
		 * polling control flow, not as fatal transport errors. Better Auth exposes
		 * those polling states directly, so the CLI needs the raw error body in
		 * order to retry, back off, or stop on terminal states like
		 * `expired_token` and `access_denied`.
		 *
		 * Returns either a successful token response or an error object. The caller
		 * should handle `authorization_pending` and `slow_down` by retrying after
		 * the appropriate interval instead of treating them like thrown failures.
		 *
		 * @example
		 * ```typescript
		 * const tokenData = await api.pollDeviceToken(deviceCode);
		 *
		 * if ('access_token' in tokenData) {
		 * 	return tokenData.access_token;
		 * }
		 *
		 * if (tokenData.error === 'authorization_pending') {
		 * 	await Bun.sleep(interval);
		 * }
		 * ```
		 */
		async pollDeviceToken(deviceCode: string) {
			const body = {
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: deviceCode,
				client_id: CLIENT_ID,
			};

			const res = await fetch(`${serverUrl}/auth/device/token`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const text = await res.text();
			let response: DeviceTokenResponse | undefined;

			if (text) {
				try {
					response = JSON.parse(text) as DeviceTokenResponse;
				} catch {
					throw new Error(
						`POST /auth/device/token: invalid JSON response: ${text.slice(0, 200)}`,
					);
				}
			}

			if (res.ok && response) {
				return response;
			}

			if (
				res.status === 400 &&
				response &&
				'error' in response &&
				typeof response.error === 'string'
			) {
				return response;
			}

			throw new Error(
				`POST /auth/device/token failed (${res.status}): ${text.slice(0, 200)}`,
			);
		},
	};
}

export type AuthApi = ReturnType<typeof createAuthApi>;
