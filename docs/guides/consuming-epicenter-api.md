# Consuming the Epicenter API

This guide explains how to connect an app to the hosted Epicenter hub at `https://api.epicenter.so`. It covers schema definition, auth setup, workspace client construction, encryption activation, and sign-out. Code examples are pulled directly from production usage in this codebase.

## Overview

The hosted hub handles auth, real-time sync, AI inference, and encryption key derivation. It runs on Cloudflare Workers with Durable Objects. Each user gets isolated DOs for their workspaces and documents—no shared state between accounts.

The workspace SDK handles the client side. You define a schema, build a client with extensions, and the SDK manages WebSocket connections, local persistence, cross-tab sync, and CRDT-level encryption. The hub and the SDK are designed to work together; you configure the glue.

## Prerequisites

Install these packages before starting:

```bash
bun add @epicenter/workspace better-auth arktype
```

The full list of imports used in this guide:

| Package | What it provides |
|---------|-----------------|
| `@epicenter/workspace` | `defineWorkspace`, `defineTable`, `createWorkspace` |
| `@epicenter/workspace/extensions/sync` | `createSyncExtension` |
| `@epicenter/workspace/extensions/sync/web` | `indexeddbPersistence` |
| `@epicenter/workspace/extensions/sync/broadcast-channel` | `broadcastChannelSync` |
| `@epicenter/workspace/shared/crypto` | `bytesToBase64`, `base64ToBytes` |
| `better-auth/client` | `createAuthClient` |
| `arktype` | `type()` for schema definitions |

## Step 1: Define Your Workspace

Use `defineWorkspace` and `defineTable` with arktype's `type()` to declare your schema. This definition is shared between the client builder and the type system—it's the single source of truth for your data shape.

```typescript
import { defineWorkspace, defineTable } from '@epicenter/workspace';
import { type } from 'arktype';

const postsTable = defineTable(
  type({
    id: 'string',
    title: 'string',
    content: 'string',
    published: 'boolean',
    _v: '1',
  }),
);

const definition = defineWorkspace({
  id: 'epicenter.my-app',
  tables: { posts: postsTable },
  kv: {},
});
```

The `_v` field is required on every table. It's the schema version marker and must be the string literal `'1'`. Table definitions use arktype's `type()` directly—not the old column helper functions (`id()`, `text()`, `boolean()`).

The `id` field in `defineWorkspace` should be namespaced to your app (e.g., `epicenter.my-app`) to avoid collisions when multiple workspaces share the same IndexedDB origin.

## Step 2: Set Up Auth

The auth client points at the hub using Better Auth. The Bearer token is passed via `fetchOptions.auth`—there's no `bearer()` plugin.

```typescript
import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
  baseURL: 'https://api.epicenter.so',
  basePath: '/auth',
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () => authToken.current, // your reactive token store
    },
    onSuccess: ({ response }) => {
      const newToken = response.headers.get('set-auth-token');
      if (newToken) authToken.set(newToken);
    },
  },
});
```

The `set-auth-token` response header carries refreshed tokens from the server. Read it in `onSuccess` and update your token store—otherwise the token will expire mid-session.

The session response includes two custom fields beyond standard Better Auth:

```typescript
type CustomSessionExtraFields = {
  encryptionKey: string; // base64-encoded, per-user HKDF-derived key
  keyVersion: number;    // which encryption key generation was used
};
```

These fields only appear in `getSession()` responses, not in `signIn` or `signUp` responses. After login, you must call `getSession()` explicitly to retrieve the encryption key.

## Step 3: Build the Workspace Client

`createWorkspace` takes your definition and returns a builder. Chain `.withEncryption()` and `.withExtension()` calls to configure the client before it connects to anything.

```typescript
import { createWorkspace } from '@epicenter/workspace';
import { createSyncExtension, toWsUrl } from '@epicenter/workspace/extensions/sync/websocket';
import { broadcastChannelSync } from '@epicenter/workspace/extensions/sync/broadcast-channel';
import { indexeddbPersistence } from '@epicenter/workspace/extensions/persistence/indexeddb';
import { bytesToBase64 } from '@epicenter/workspace/shared/crypto';

const client = createWorkspace(definition)
  .withEncryption({
    onActivate: (userKey) => keyCache.save(bytesToBase64(userKey)),
    onDeactivate: () => keyCache.clear(),
  })
  .withExtension('persistence', indexeddbPersistence)
  .withExtension('broadcast', broadcastChannelSync)
  .withExtension('sync', createSyncExtension({
    url: (workspaceId) => toWsUrl(`https://api.epicenter.so/workspaces/${workspaceId}`),
    getToken: async () => authState.token,
  }));
```

Extension ordering matters. Each extension waits for the previous one via `whenReady` before initializing:

1. `withEncryption`—opts into encryption. Must come before any extension that reads or writes data.
2. `persistence`—loads existing state from IndexedDB. Provides the state vector that sync uses to request only missing updates.
3. `broadcast`—BroadcastChannel for instant cross-tab sync. Runs after persistence so it starts with the correct local state.
4. `sync`—WebSocket connection to the hub. Connects last, after local state is ready.

The sync extension's `url` callback receives the workspace ID and returns a WebSocket URL (`ws:` or `wss:`). Use the `toWsUrl` helper to convert an HTTP base URL if needed. `getToken` is called on every connect and reconnect—the same token is used for both the WebSocket handshake (`?token=` query param) and HTTP snapshot requests (`Authorization: Bearer` header).

## Step 4: Activate Encryption After Login

After a successful sign-in, fetch the session to get the encryption key and activate it on the client:

```typescript
import { base64ToBytes } from '@epicenter/workspace/shared/crypto';

async function refreshEncryptionKey() {
  const { data } = await authClient.getSession();
  if (data?.encryptionKey) {
    await client.activateEncryption(base64ToBytes(data.encryptionKey));
  }
}

// Call after signIn() or signUp() succeeds
await refreshEncryptionKey();
```

On subsequent app launches, restore from cache first (fast, works offline), then validate against the server:

```typescript
// Restore cached key immediately
const cached = await keyCache.load();
if (cached) await client.activateEncryption(base64ToBytes(cached));

// Then validate session against server
const { data, error } = await authClient.getSession();
if (error?.status && error.status < 500) {
  // Server explicitly rejected — clear everything
  await client.deactivateEncryption();
  clearAuthState();
} else if (data?.encryptionKey) {
  // Server confirmed — activateEncryption deduplicates (same key = no-op)
  await client.activateEncryption(base64ToBytes(data.encryptionKey));
}
```

The `< 500` check distinguishes an explicit auth rejection (4xx) from a network failure or server error (5xx). On a 5xx, keep the cached key and let the user continue working offline. On a 4xx, the session is gone—clear the key and auth state.

Calling `activateEncryption` with the same key twice is a no-op. The deduplication is intentional; you don't need to compare keys before calling.

## Step 5: Sign-Out and Cleanup

```typescript
async function signOut() {
  await client.deactivateEncryption();
  await authClient.signOut().catch(() => {});
  clearAuthState();
}
```

`deactivateEncryption()` clears the in-memory key, deactivates encrypted stores, wipes persisted encrypted data via `clearData` callbacks registered by extensions, and fires the `onDeactivate` hook. Call it before `signOut()`—the order matters because `deactivateEncryption` needs the client to still be in an active state to clean up properly.

The `.catch(() => {})` on `signOut()` is intentional. If the network is unavailable, the local cleanup still completes. The server-side session will expire on its own.

## API Endpoints Reference

All endpoints are on `https://api.epicenter.so`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | No | Health check (`{ mode, version, runtime }`) |
| GET/POST | `/auth/*` | No | Better Auth (sign-in, sign-up, OAuth, session management) |
| GET | `/.well-known/openid-configuration/auth` | No | OpenID Connect discovery |
| GET | `/.well-known/oauth-authorization-server/auth` | No | OAuth server metadata |
| POST | `/ai/chat` | Bearer | Stream AI chat completions via SSE |
| GET | `/workspaces/:workspace` | Bearer | Get workspace doc (binary) or upgrade to WebSocket |
| POST | `/workspaces/:workspace` | Bearer | HTTP sync—send Yjs update, receive diff or 304 |
| GET | `/documents/:document` | Bearer | Get document doc (binary) or upgrade to WebSocket |
| POST | `/documents/:document` | Bearer | HTTP sync for documents |
| POST | `/documents/:document/snapshots` | Bearer | Save document snapshot |
| GET | `/documents/:document/snapshots` | Bearer | List document snapshots |
| GET | `/documents/:document/snapshots/:id` | Bearer | Get specific snapshot (binary) |
| DELETE | `/documents/:document/snapshots/:id` | Bearer | Delete snapshot |

Workspaces and documents are distinct resource types. WorkspaceRooms use `gc: true` (garbage collection enabled for transient metadata). DocumentRooms use `gc: false` with snapshot history for long-form content that needs version history.

HTTP requests authenticate with `Authorization: Bearer <token>`. WebSocket connections pass the token as a `?token=` query parameter. The sync extension handles both automatically via `getToken`.

CORS allows `https://epicenter.so`, `https://*.epicenter.so`, `tauri://localhost`, and Chrome extension origins. Max POST body size is 5 MB.

## Encryption Model

The server derives per-user encryption keys via HKDF-SHA256 from a deployment secret (`ENCRYPTION_SECRETS` env var). The key is deterministic—same secret plus same userId always produces the same key. This means password recovery works without storing the key anywhere.

Data is encrypted at the CRDT level using XChaCha20-Poly1305. Individual values within the Y.Doc are encrypted; the CRDT structure (key names, timestamps for conflict resolution) remains visible to the server. This lets the server power search, AI processing, and password recovery while keeping the raw data opaque to anyone without the key.

A database dump or compromised storage bucket yields ciphertext. The encryption key lives in the application secret, not in the data store.

For more on the trade-offs behind this model:

- [`docs/articles/why-e2e-encryption-keeps-failing.md`](/docs/articles/why-e2e-encryption-keeps-failing.md)—PGP, Signal, and the structural problem with client-managed keys
- [`docs/articles/let-the-server-handle-encryption.md`](/docs/articles/let-the-server-handle-encryption.md)—the pragmatic alternative
- [`docs/articles/if-you-dont-trust-the-server-become-the-server.md`](/docs/articles/if-you-dont-trust-the-server-become-the-server.md)—self-hosting as the clean answer

## Self-Hosting

See `apps/api/README.md` for deployment details.

The key difference between using the hosted hub and running your own: change `ENCRYPTION_SECRETS` to a secret you control, and the same binary becomes functionally zero-knowledge. The server still holds the key—but the server is yours. Same code, same API surface, same SDK. The deployment is the trust boundary.
