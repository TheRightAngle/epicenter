# Encryption architecture
Epicenter encrypts CRDT values before they enter the synced Yjs document.
That keeps the sync path moving ciphertext instead of application JSON.
This page only makes claims visible in the current code:
- `packages/workspace/src/shared/crypto/index.ts`
- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`
- `packages/workspace/src/workspace/encryption-key.ts`
- `packages/workspace/src/workspace/create-workspace.ts`
- `apps/api/src/auth/encryption.ts`
- `apps/api/src/auth/create-auth.ts`
- `packages/svelte-utils/src/auth/create-auth.svelte.ts`
- `packages/workspace/src/extensions/persistence/indexeddb.ts`
- `apps/api/src/base-sync-room.ts`
If something is not visible there, it is not presented as fact here.

## What this system is
This is server-managed encryption at the workspace value layer.
It is not user-held end-to-end encryption.
The auth server derives per-user keys from `ENCRYPTION_SECRETS` and returns them in the session response.
The client derives per-workspace keys locally and uses those keys to encrypt individual CRDT values.
That split is the trust boundary.
The sync path only relays encrypted values.
The auth path can derive user keys because it has access to the deployment secret.

## Key hierarchy
The hierarchy is two-stage.
Server code derives a per-user key.
Client code derives a per-workspace key from that user key.
```text
ENCRYPTION_SECRETS entry
        |
        | SHA-256(secret)
        v
root key material
        |
        | HKDF-SHA256 info = "user:{userId}"
        v
user key
        |
        | HKDF-SHA256 info = "workspace:{workspaceId}"
        v
workspace key
        |
        | XChaCha20-Poly1305
        v
encrypted CRDT value
```
On the server, `apps/api/src/auth/encryption.ts` hashes each configured secret with SHA-256, imports that digest into Web Crypto HKDF, and derives 256 bits with `info = user:{userId}`.
It returns one `{ version, userKeyBase64 }` entry per configured secret version.
On the client, `createWorkspace().applyEncryptionKeys()` decodes each `userKeyBase64`, runs `deriveWorkspaceKey(userKey, workspaceId)`, and gets a 32-byte workspace key with `info = workspace:{workspaceId}`.
The highest version becomes the current key for new writes.

## How keys reach the client
Keys come through the auth session.
There is no separate key-fetch endpoint in the reviewed code.
`apps/api/src/auth/create-auth.ts` attaches `encryptionKeys` to `/auth/get-session`.
`packages/svelte-utils/src/auth/create-auth.svelte.ts` then pushes those keys through `onLogin`.
That happens in two places:
- on boot from a cached session
- on every authenticated session update from Better Auth
The boot path exists so the workspace can unlock before the first auth roundtrip finishes.
In app clients such as `apps/tab-manager/src/lib/client.ts`, `onLogin(session)` does this:
```ts
workspace.applyEncryptionKeys(session.encryptionKeys);
workspace.extensions.sync.reconnect();
```
The order matters.
Keys are applied before sync reconnects.

## Key lifecycle in the current code
Keys are definitely loaded on login.
That part is explicit.
Logout is less clean than the high-level comments suggest.
The reviewed code clears the auth session and wipes persisted local data, but it does not show an explicit in-memory key wipe inside `createEncryptedYkvLww`.
The logout path in the app clients is:
```ts
onLogout() {
  workspace.clearLocalData();
  workspace.extensions.sync.reconnect();
}
```
And the auth state transition in `create-auth.svelte.ts` is:
```ts
session.current = null;
onLogout?.();
```
`workspace.clearLocalData()` runs extension `clearLocalData` hooks.
For IndexedDB persistence, that hook is `idb.clearData()`.
So these points are implemented and verifiable:
- keys are loaded on login
- the persisted IndexedDB copy is wiped on logout
- sync reconnects without an authenticated session token
This point is not visible as an explicit step in the reviewed code:
- clearing the in-memory encryption state after logout
That gap matters because the encrypted wrapper exposes `activateEncryption()` but no `deactivateEncryption()`.
If you are reviewing the threat model, treat that as a real property of the current implementation.

## Binary envelope format
Encrypted values are stored as a bare `Uint8Array`.
There is no JSON ciphertext wrapper.
The v1 layout is exactly:
```text
formatVersion(1) || keyVersion(1) || nonce(24) || ciphertext || tag(16)
```
The byte layout looks like this:
```text
Byte:  0              1              2                           26
       +--------------+--------------+---------------------------+----------------------+
       | formatVersion| keyVersion   | nonce                     | ciphertext || tag    |
       | 1 byte       | 1 byte       | 24 bytes                  | variable + 16 bytes  |
       +--------------+--------------+---------------------------+----------------------+
```
The minimum blob size is 42 bytes.
That is `2 + 24 + 16`, which is the empty-plaintext case.
`encryptValue()` writes the header like this:
- byte 0: format version, currently `1`
- byte 1: key version
- bytes 2..25: random 24-byte nonce
- bytes 26..end: ciphertext plus the 16-byte Poly1305 tag
`decryptValue()` validates the format version first.
If it is not `1`, decryption throws.
The key version is metadata, not decryption logic by itself.
The wrapper reads `blob[1]` with `getKeyVersion(blob)` and chooses the matching key before calling `decryptValue()`.

## Why XChaCha20-Poly1305
The code uses XChaCha20-Poly1305 from `@noble/ciphers`.
The reason is simple: workspace writes are synchronous, so the encryption path must also stay synchronous.
The implementation uses a 32-byte key, a 24-byte nonce, and optional AAD.

## Encrypted CRDTs without forking the CRDT
Epicenter does not fork the LWW CRDT.
It wraps it.
The core store is `YKeyValueLww`.
The encryption layer is `createEncryptedYkvLww()`.
That wrapper keeps timestamps, conflict resolution, pending state, and observer mechanics in the original CRDT and only transforms values at the boundary.
The write path is:
```text
set(key, value)
  -> JSON.stringify(value)
  -> encryptValue(json, workspaceKey, aad = keyBytes, keyVersion)
  -> inner.set(key, encryptedBlob)
```
The read path is:
```text
get(key)
  -> inner.get(key)
  -> decryptValue(blob, selectedKey, aad = keyBytes)
  -> JSON.parse(json)
```
Observers follow the same pattern.
The inner CRDT emits changes, the wrapper decrypts changed entries, and callers see plaintext change events.
The reason for composition is concrete.
The file comment explains that Yjs `ContentAny` stores entry objects by reference, and `YKeyValueLww` relies on `indexOf()` with strict reference equality.
If the CRDT were forked to replace entries with freshly decrypted objects, that reference equality would break.
So the design is not “encryption-aware CRDT logic.”
It is “existing CRDT logic plus an encryption wrapper at the edges.”

## What is and is not encrypted
The value payload is encrypted.
The surrounding CRDT structure is not.
That means a synced entry still has a key and timestamp in the Yjs data model.
What changes is the `val` field.
When encryption is active, `val` becomes an opaque `Uint8Array` blob.
The code also binds the entry key as AAD by passing `textEncoder.encode(key)` to both encrypt and decrypt.
That prevents a simple ciphertext transplant from one entry key to another.

## No plaintext cache
Reads decrypt on the fly.
The wrapper does not maintain a separate plaintext cache.
That trade is explicit in the implementation comments: decrypting a small XChaCha20-Poly1305 blob is cheap, while a dual cache would add complexity around observers, resync, and missed transactions.
`entries()` and `readableEntries()` decrypt as they iterate.
Undecryptable entries are skipped.

## One-way activation
Encryption activation is one-way by API surface.
The wrapper has `activateEncryption(keyring)`.
It does not have `deactivateEncryption()`.
Before activation, the wrapper is a passthrough store and `set()` writes plaintext values into the inner CRDT.
After activation, `set()` always encrypts.
The active state holds the full keyring, the current key, and the current key version.
Calling `activateEncryption()` again updates that state to a new keyring, but it does not switch the store back to plaintext mode.
`createWorkspace()` reinforces that shape.
All table stores and the KV store are created as encrypted wrappers from the start, and `applyEncryptionKeys()` later activates encryption across all of them.

## What activation re-encrypts
Activation does not rewrite everything.
It only re-encrypts plaintext entries.
The code in `activateEncryption()` walks the inner map and splits entries into two groups:
- plaintext entries to encrypt now
- encrypted blobs to leave alone
For already encrypted blobs, the wrapper checks whether they were unreadable before and readable now.
If a new keyring makes old blobs readable, it emits synthetic add events so observers can see them.
It does not rewrite those blobs.

## Key rotation
Key rotation is versioned and lazy.
The blob carries the key version that encrypted it.
New writes always use the highest key version in the active keyring.
Old blobs keep their old version byte.
Decryption follows this order:
1. try the current key first
2. if that fails, read `blob[1]`
3. look up that version in the keyring
4. try that specific key
That avoids brute-forcing every key.
The blob tells the client which version it needs.
Rotation does not bulk re-encrypt existing ciphertext.
Only plaintext entries get re-encrypted when encryption is activated.
Existing ciphertext, even if it uses an old key version, stays as-is until the next write to that key.

## What the sync server sees
The sync server sees Yjs updates and relays them.
In the reviewed server code, `BaseSyncRoom.sync()` calls `Y.applyUpdateV2(this.doc, update, 'http')` and returns diffs with `Y.encodeStateAsUpdateV2(this.doc, clientSV)`.
The WebSocket path broadcasts raw protocol messages to peers.
There is no decryption step in that sync room code.
Because encryption happens before values are written into the Yjs document, the synced value payloads are ciphertext blobs.
Be precise here.
The relay does not see only random bytes.
It still sees the CRDT skeleton: document structure, entry keys, and timestamps.
What it does not get is plaintext application values.

## Error handling and unreadable data
Decryption failures do not take down the whole observer stream.
The wrapper catches failures, logs a warning, skips the unreadable entry, and keeps going.
It also exposes `unreadableEntryCount` and `readableEntryCount`.
That makes corruption or missing key versions visible without forcing a hard crash on every read.

## What this means for a security review
The useful parts are clear.
Values are encrypted before sync, the blob format is self-describing, key rotation is versioned, and the CRDT logic is reused instead of forked.
The trust model is also clear.
This is not a zero-knowledge design.
The auth server can derive per-user transport keys from `ENCRYPTION_SECRETS`, while the sync relay forwards ciphertext values rather than plaintext values.
The sharp edge is logout behavior.
Persisted local data is wiped on logout through the IndexedDB extension, but an explicit in-memory key deactivation path is not present in the reviewed code.
If you are deciding whether this architecture fits your threat model, focus on that line: the sync relay handles ciphertext values, but the deployment that owns `ENCRYPTION_SECRETS` remains inside the trust boundary.
