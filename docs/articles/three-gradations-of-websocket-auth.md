# Three Gradations of WebSocket Auth

You own a WebSocket server. Clients connect to sync data in real time. The question is: who gets to connect? There are three levels, each adding one piece to the handshake. Pick the one that matches your threat model.

## Level 1: URL Only

The client knows the URL. That's it. No credentials, no handshake, no token exchange. The server accepts any connection.

```typescript
// Client
const ws = new WebSocket('ws://localhost:3913/sync/my-doc');
```

```typescript
// Server
server.ws('/sync/:docId', {
	open(ws) {
		// Everyone's welcome
		const doc = getDoc(ws.data.params.docId);
		startSync(ws, doc);
	},
});
```

This is fine when the network itself is the boundary: localhost, a Tailscale mesh, a LAN. If you can reach the URL, you're trusted. No secret to leak, no token to expire, no auth service to keep running. Local dev, private networks, air-gapped environments.

## Level 2: URL + Static Token

The person who runs the server picks a secret when they start it. Anyone who knows both the URL and the secret can connect; everyone else gets rejected.

Say you're self-hosting a sync server on your home network. You start it with a token you choose:

```bash
# Server owner picks a secret at startup
sync-server start --token my-shared-secret --port 3913
```

The server reads that token and checks it on every incoming WebSocket connection:

```typescript
// Server
function startSyncServer(options: { token: string; port: number }) {
	const server = Bun.serve({
		port: options.port,
		websocket: {
			open(ws) {
				const url = new URL(ws.data.url, 'http://localhost');
				if (url.searchParams.get('token') !== options.token) {
					ws.close(4001, 'Unauthorized');
					return;
				}
				const doc = getDoc(ws.data.params.docId);
				startSync(ws, doc);
			},
		},
	});
}
```

Clients pass the same secret as a query parameter:

```typescript
// Client
const ws = new WebSocket(
	'ws://my-server:3913/sync/my-doc?token=my-shared-secret',
);
```

One step up from open access. The token is long-lived and shared across all clients, but the server owner controls it. It works for self-hosted setups where you trust every client: a personal sync server, a family home lab, a small team's internal tool. If the token leaks, the server owner picks a new one and restarts.

## Level 3: URL + Dynamic Token (getToken)

The client calls an async function before each connection to fetch a short-lived token from your auth service. The server validates the token's signature and expiry on every connection attempt.

```typescript
// Client
async function getToken(
	docId: string,
): Promise<{ url: string; token: string }> {
	const res = await fetch('/api/sync/token', {
		method: 'POST',
		headers: { Authorization: `Bearer ${sessionToken}` },
		body: JSON.stringify({ docId }),
	});
	return res.json(); // { url: 'wss://sync.example.com/sync/my-doc', token: 'eyJhbG...' }
}

const { url, token } = await getToken('my-doc');
const ws = new WebSocket(`${url}?token=${token}`);
```

```typescript
// Server
server.ws('/sync/:docId', {
	open(ws) {
		const url = new URL(ws.data.url, 'http://localhost');
		const token = url.searchParams.get('token');
		const payload = verifyJwt(token); // checks signature + expiry
		if (!payload) {
			ws.close(4001, 'Unauthorized');
			return;
		}
		const doc = getDoc(ws.data.params.docId);
		startSync(ws, doc);
	},
});
```

This is the production pattern. Tokens are short-lived (minutes, not months), per-connection, scoped to a specific document, and tied to an authenticated user. If a token leaks, it expires before anyone can use it. If a user loses access, the next `getToken` call fails and the connection never opens.

Every major real-time service uses this exact flow: Firebase Realtime Database, Supabase Realtime, Liveblocks, Y-Sweet, Pusher, Ably. The details vary (some use WebSocket subprotocols instead of query params, some embed claims differently), but the shape is always the same: client asks auth service for a short-lived credential, passes it on the WebSocket handshake, server validates before accepting.

## The Comparison

| Concern          | URL only                    | URL + static token              | URL + getToken           |
| ---------------- | --------------------------- | ------------------------------- | ------------------------ |
| Who can connect  | Anyone who knows the URL    | Anyone with the shared secret   | Anyone with a valid JWT  |
| Token lifetime   | N/A                         | Months (until manually rotated) | Minutes (auto-expires)   |
| Per-user scoping | No                          | No (same token for everyone)    | Yes (claims in JWT)      |
| Revocation       | Change the URL              | Rotate the secret, redeploy     | Stop issuing tokens      |
| Good for         | Local dev, private networks | Self-hosted, small teams        | Production, multi-tenant |

| Concern          | Mode 1 (URL only)      | Mode 2 (URL + token)   | Mode 3 (URL + getToken)             |
| ---------------- | ---------------------- | ---------------------- | ----------------------------------- |
| Who can connect  | Anyone                 | Anyone with the secret | Anyone with a valid JWT             |
| Encryption       | Same XChaCha20-Poly1305 | Same                   | Same                                |
| Key distribution | QR / passphrase        | QR / passphrase        | Server-side key vault (wrapped DKs) |
| Recovery         | Recovery secret only   | Recovery secret only   | Password + recovery code            |
| Multi-device     | Manual secret transfer | Manual secret transfer | Login → auto-fetch wrapped DK       |

The jump from level 2 to level 3 is where self-hosted becomes production-ready. Static tokens can't distinguish between users, can't expire gracefully, and can't be scoped to specific resources. Dynamic tokens solve all three, at the cost of running an auth service that issues them.

Most apps start at level 1 during local development, skip level 2 entirely, and jump straight to level 3 when they ship. The middle ground exists for the cases where you trust the network but want a basic gate: a shared family server, a Tailscale-connected home lab, an internal company tool that doesn't justify a full auth stack.
