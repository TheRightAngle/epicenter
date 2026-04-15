/**
 * Minimal Cloudflare type stubs for hc<AppType> resolution.
 *
 * The dashboard imports AppType from @epicenter/api, which carries
 * Cloudflare.Env in its type chain. The hc client doesn't USE these
 * types (it only needs route signatures), but TypeScript must RESOLVE
 * the full chain. This stub satisfies the checker without pulling in
 * the full Worker types.
 *
 * See: https://github.com/honojs/hono/issues/2489
 */

declare namespace Cloudflare {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	type Env = {};
}

// Cloudflare Workers runtime modules referenced by the API
declare module 'cloudflare:workers' {
	export class DurableObject {
		constructor(ctx: unknown, env: unknown);
		fetch?(request: Request): Promise<Response>;
		alarm?(): Promise<void>;
		webSocketMessage?(
			ws: WebSocket,
			message: string | ArrayBuffer,
		): Promise<void>;
		webSocketClose?(
			ws: WebSocket,
			code: number,
			reason: string,
			wasClean: boolean,
		): Promise<void>;
		webSocketError?(ws: WebSocket, error: unknown): Promise<void>;
	}
}
