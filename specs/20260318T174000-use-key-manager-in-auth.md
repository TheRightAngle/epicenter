# Use createKeyManager in auth.svelte.ts

## Problem

`apps/tab-manager/src/lib/state/auth.svelte.ts` inlines ~30 lines of key management logic (dedup, race protection, HKDF derivation, key caching) that duplicates `packages/workspace/src/shared/crypto/key-manager.ts` exactly. The inlined code even has a comment acknowledging this: `// Inlined key management (replaces createKeyManager)`.

## Solution

Replace the inlined logic with `createKeyManager(workspace, { keyCache })`. The key-manager factory already provides:
- **Dedup**---same key check via `lastKeyBase64`
- **Race protection**---generation counter ensures stale HKDF results never land
- **HKDF derivation**---`base64ToBytes` + `deriveWorkspaceKey` internally
- **Key caching**---writes to `keyCache` when userId provided

## Changes

- [x] `packages/workspace/package.json`---Add `"./shared/crypto/key-manager"` export path
- [x] `apps/tab-manager/src/lib/state/auth.svelte.ts`---Replace inlined key management with `createKeyManager`
- [x] Update all 6 call sites to use key-manager API
- [x] Verify no type errors via LSP diagnostics

### Caller mapping

| Old | New | Location |
|---|---|---|
| `activateSession(base64, userId)` | `keyManager.activateEncryption(base64, userId)` | refreshEncryptionKey, checkSession success |
| `deactivateSession()` | `keyManager.clearKeys()` + `workspace.deactivateEncryption()` | signOut, checkSession 4xx |
| `restoreFromCache(userId)` | `keyManager.restoreKeyFromCache(userId)` | $effect, checkSession boot |

### Behavioral note

`deactivateSession()` combined key invalidation + data wipe + cache clear in one function. The new code splits this:
1. `keyManager.clearKeys()`---invalidates generation counter, clears lastKeyBase64, clears keyCache
2. `workspace.deactivateEncryption()`---wipes encrypted stores and IndexedDB

This split is semantically cleaner: "forget keys" vs "wipe data" are separate concerns.

## Review

- Removed imports: `base64ToBytes`, `deriveWorkspaceKey` from `@epicenter/workspace/shared/crypto`
- Added import: `createKeyManager` from `@epicenter/workspace/shared/crypto/key-manager`
- Removed: `lastKeyBase64`, `keyGeneration`, `activateSession()`, `deactivateSession()`, `restoreFromCache()` (30 lines)
- Added: `const keyManager = createKeyManager(workspace, { keyCache })` (1 line)
- Net: -29 lines, zero behavioral change
- LSP diagnostics: clean (no type errors)
