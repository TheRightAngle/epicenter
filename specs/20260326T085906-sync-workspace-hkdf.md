# Sync Workspace HKDF

**Date**: 2026-03-26
**Status**: Implemented
**Author**: Codex
**Branch**: `feat/sync-auto-reconnect`

This spec is a prerequisite for:

- `specs/20260326T084710-opinionated-workspace-auth-api.md`

## Overview

Replace async Web Crypto HKDF in the workspace encryption lifecycle with synchronous HKDF from `@noble/hashes`, but keep cache restore and persistence cleanup async where they still need to await real I/O. The goal is not a crypto redesign. The goal is to make `workspace.encryption` easier to reason about by making the runtime unlock path synchronous and narrowing the remaining async behavior to cache and persistence seams.

## Motivation

### Current State

The current workspace key derivation is async:

```typescript
async function deriveWorkspaceKey(
  userKey: Uint8Array,
  workspaceId: string,
): Promise<Uint8Array> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    userKey.buffer as ArrayBuffer,
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
```

That async HKDF drives extra complexity in the workspace encryption controller:

```typescript
let lastUserKey: Uint8Array | undefined;
let keyGeneration = 0;
let workspaceKey: Uint8Array | undefined = options?.key;

const activate = async (userKey: Uint8Array) => {
  if (lastUserKey && bytesEqual(lastUserKey, userKey)) return;

  const thisGen = ++keyGeneration;
  let nextWorkspaceKey: Uint8Array;

  try {
    nextWorkspaceKey = await deriveWorkspaceKey(userKey, id);
  } catch (error) {
    console.error('[workspace] Key derivation failed:', error);
    return;
  }

  if (thisGen !== keyGeneration) return;

  for (const store of encryptedStores) {
    store.activateEncryption(nextWorkspaceKey);
  }

  workspaceKey = nextWorkspaceKey;
  await config?.userKeyCache?.save(bytesToBase64(userKey));
};

const deactivate = async () => {
  ++keyGeneration;
  lastUserKey = undefined;
  workspaceKey = undefined;
  for (const store of encryptedStores) {
    store.deactivateEncryption();
  }
  // clear callbacks + cache clear
};
```

The encrypted store layer beneath that is already synchronous:

```typescript
activateEncryption(nextKey) {
  currentKey = nextKey;
  map.clear();

  for (const [key, entry] of inner.map) {
    const decryptedEntry = tryDecryptEntry(key, entry);
    if (!decryptedEntry) continue;
    map.set(key, decryptedEntry);
  }

  for (const [entryKey, entry] of inner.map) {
    if (isEncryptedBlob(entry.val)) continue;
    inner.set(entryKey, encryptValue(JSON.stringify(entry.val), nextKey));
  }
}
```

This creates problems:

1. **The runtime unlock path looks more concurrent than it really is**: the actual store transition is synchronous, but the controller reads like a multi-stage race.
2. **`keyGeneration` is solving an async HKDF problem, not an encryption-model problem**: that makes the lifecycle harder to explain than it needs to be.
3. **Runtime state change and persistence side effects are bundled together**: deriving/applying the key and saving/clearing the cached user key are different concerns.
4. **The current types and docs overemphasize the async derivation mechanism**: they explain generation invalidation rather than the simpler boundary we actually want.

### Desired State

The desired lifecycle is:

```text
activate(userKey)
├── derive workspace key synchronously
├── apply it to encrypted stores synchronously
├── set runtime encryption state synchronously
└── then await optional cache persistence

deactivate()
├── clear runtime encryption state synchronously
├── deactivate stores synchronously
└── then await cleanup callbacks and cache clear
```

That keeps the public API async where necessary, but the runtime encryption transition itself becomes immediate and easy to understand.

## Research Findings

### The Existing Derivation Contract Is Small and Stable

Current derivation contract:

| Dimension | Current value |
| --- | --- |
| KDF | HKDF-SHA256 |
| Input | root user key |
| Salt | empty `Uint8Array(0)` |
| Info | `workspace:${workspaceId}` |
| Output length | 32 bytes |

**Key finding**: the derivation contract is already narrow enough to swap implementations without changing the encryption model.

**Implication**: this can be a conservative refactor if the output bytes remain identical.

### `@noble/hashes` Covers the Missing Piece

Current workspace crypto dependencies already use audited sync primitives from the Noble stack:

| Concern | Current library |
| --- | --- |
| content encryption | `@noble/ciphers` |
| sync HKDF candidate | `@noble/hashes` |

Likely sync replacement:

```typescript
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

function deriveWorkspaceKey(userKey: Uint8Array, workspaceId: string): Uint8Array {
  return hkdf(
    sha256,
    userKey,
    new Uint8Array(0),
    new TextEncoder().encode(`workspace:${workspaceId}`),
    32,
  );
}
```

**Key finding**: we do not need to invent custom HKDF code or change libraries wholesale.

**Implication**: add `@noble/hashes` as a direct dependency of `@epicenter/workspace` and keep the change small.

### The Remaining Async Work Is Not HKDF

After removing async HKDF, the remaining awaited work is:

| Step | Why async remains |
| --- | --- |
| `userKeyCache.save(...)` | persistence seam |
| `userKeyCache.load(...)` | persistence seam |
| `userKeyCache.clear(...)` | persistence seam |
| `clearDataCallbacks[i]?.()` | IndexedDB / extension cleanup |

**Key finding**: the real async boundaries are persistence and cleanup, not runtime encryption.

**Implication**: keep `activate`, `restoreEncryptionFromCache`, and `deactivate` async publicly, but narrow the runtime critical path to synchronous work.

### Compatibility Needs To Be Proved, Not Assumed

Current tests cover:

- dedup
- race protection
- `isEncrypted`
- cache restore
- deactivate/activate race behavior

They do not yet prove:

- byte-for-byte equality between old Web Crypto HKDF and new sync HKDF
- final cache state under slow save / deactivate overlap once HKDF is no longer the async source

**Key finding**: some existing tests will need to be rewritten because they assert old HKDF race semantics, not the new simpler model.

**Implication**: add explicit compatibility fixtures and replace race tests with tests for persistence ordering.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| HKDF implementation | Switch to sync `@noble/hashes` HKDF | Removes unnecessary async in the runtime unlock path |
| Derivation contract | Preserve exactly | This is a refactor, not a crypto redesign |
| `deriveWorkspaceKey` return type | `Uint8Array` sync return | Makes the runtime path immediate |
| `activate(userKey)` return type | Keep `Promise<void>` | Cache save still needs awaiting |
| Runtime unlock timing | Synchronous before awaiting persistence | Makes the real encryption boundary easy to understand |
| `deactivate()` return type | Keep `Promise<void>` | Cleanup callbacks and cache clear are still async |
| HKDF race guard | Remove the HKDF-specific generation invalidation | That race no longer exists after sync derivation |
| Persistence ordering | Replace with a smaller persistence-ordering mechanism if needed | Any remaining async coordination should describe cache/cleanup ordering, not stale HKDF |
| Compatibility proof | Add fixed-fixture comparison tests | Do not claim identical output without proving it |
| Migration surface | None | No ciphertext, cache format, or public API contract changes |

## Architecture

### Current Lifecycle

```text
activate(userKey)
├── async HKDF derive
├── generation check
├── sync apply to stores
└── async cache save

deactivate()
├── generation bump
├── sync store clear
└── async cleanup
```

### Proposed Lifecycle

```text
activate(userKey)
├── sync HKDF derive
├── sync apply to stores
├── runtime encryption state is now active
└── async cache save

deactivate()
├── sync runtime deactivation
├── sync store deactivation
└── async cleanup + cache clear
```

### Runtime vs Persistence Boundary

```text
RUNTIME ENCRYPTION
──────────────────
deriveWorkspaceKey(userKey, workspaceId)
store.activateEncryption(workspaceKey)
workspaceKey = derivedKey

PERSISTENCE SIDE EFFECTS
────────────────────────
userKeyCache.save(...)
userKeyCache.load(...)
userKeyCache.clear(...)
clearDataCallbacks[i]?.()
```

This is the key simplification. Runtime encryption state becomes synchronous. Persistence remains async.

## Implementation Plan

### Phase 1: Sync derivation foundation

- [x] **1.1** Add `@noble/hashes` as a direct dependency of `packages/workspace`.
- [x] **1.2** Replace async Web Crypto HKDF in `packages/workspace/src/shared/crypto/index.ts` with sync Noble HKDF.
- [x] **1.3** Update docs and JSDoc in `packages/workspace/src/shared/crypto/index.ts` to describe sync derivation accurately.
- [x] **1.4** Add compatibility tests that compare fixed Web Crypto HKDF output against the new sync implementation for identical inputs.

### Phase 2: Simplify the encryption controller

- [x] **2.1** Refactor `workspace.encryption.activate(...)` so key derivation and store activation happen synchronously before any awaited persistence.
- [x] **2.2** Remove the HKDF-specific `keyGeneration` invalidation logic from `packages/workspace/src/workspace/create-workspace.ts`.
- [x] **2.3** Introduce a smaller serialized persistence path that coordinates `userKeyCache.save()` versus `userKeyCache.clear()`.
- [x] **2.4** Update lifecycle comments to describe the new runtime-vs-persistence split clearly.

### Phase 3: Update tests and types

- [x] **3.1** Rewrite or remove tests that only exist to assert in-flight HKDF invalidation behavior.
- [x] **3.2** Add tests for final cache state when activation persistence overlaps with deactivation.
- [x] **3.3** Update `packages/workspace/src/workspace/types.ts` docs so they no longer mention async HKDF or generation invalidation.
- [x] **3.4** Run the relevant `packages/workspace` test suite and typecheck.
  > **Note**: `bun run typecheck` still fails in pre-existing files outside this HKDF refactor, including `packages/sync-client/src/provider.ts`, `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`, `packages/workspace/src/timeline/*.test.ts`, and existing `packages/workspace` extension/type tests.

## Edge Cases

### Same key activated twice after a failed cache save

1. `activate(userKey)` applies encryption successfully.
2. `userKeyCache.save(...)` fails.
3. A second `activate(userKey)` should retry persistence rather than silently skip forever.

### Activate then immediate deactivate

1. `activate(userKey)` synchronously unlocks the workspace.
2. `deactivate()` runs before cache save settles.
3. Final runtime state must be deactivated.
4. Final cache state must be cleared, not overwritten by a stale save.

### Rapid key switches

1. `activate(keyA)` runs.
2. `activate(keyB)` runs before persistence for `keyA` settles.
3. Final runtime state must use `keyB`.
4. Final cached key must also converge on `keyB`, or be cleared if deactivation happened later.

### Cache restore with corrupt cached data

1. `restoreEncryptionFromCache()` loads an invalid base64 string.
2. It must still clear the bad cache entry and leave runtime encryption deactivated.

## Open Questions

1. **How should we coordinate save/clear ordering after removing `keyGeneration`?**
   - Options: (a) no coordination at all, (b) a tiny persistence epoch/token, (c) a serialized persistence queue.
   - **Recommendation**: choose (c) if coordination is still needed. A small serialized persistence queue matches the real remaining async concern better than a stale-HKDF generation counter.

2. **Should `activate(userKey)` set dedup state before or after cache save succeeds?**
   - Options: (a) before, dedup runtime only; (b) after, preserve today's retry-on-save-failure behavior; (c) split runtime and persisted dedup tracking.
   - **Recommendation**: choose (c) if needed. Track runtime activation separately from persisted-key success so the workspace can unlock immediately and still retry cache persistence honestly.

3. **Should the implementation keep a compatibility helper for the old Web Crypto derivation in tests only?**
   - Options: (a) yes, test-only helper, (b) no, trust the parameter match, (c) snapshot one fixture and stop there.
   - **Recommendation**: choose (a). Keep a tiny test-only Web Crypto implementation so byte-for-byte compatibility is proven rather than implied.

## Success Criteria

- [x] `deriveWorkspaceKey(...)` is synchronous and still derives the same 32-byte output for identical inputs.
- [x] Runtime workspace unlock happens synchronously before any awaited cache persistence.
- [x] `workspace.encryption.activate(...)`, `restoreEncryptionFromCache()`, and `deactivate()` retain their existing public meanings.
- [x] Existing encrypted data and cached user keys remain compatible.
- [x] Tests cover derivation compatibility and persistence ordering under activate/deactivate overlap.
- [x] The workspace lifecycle comments and docs describe a simpler, more honest model than the current generation-based explanation.

## References

- `packages/workspace/src/shared/crypto/index.ts` - current HKDF implementation
- `packages/workspace/src/workspace/create-workspace.ts` - current encryption controller
- `packages/workspace/src/workspace/create-workspace.test.ts` - lifecycle and cache tests
- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts` - synchronous key-application layer
- `packages/workspace/src/workspace/types.ts` - public encryption controller docs
- `packages/workspace/package.json` - dependency surface

## Review

**Completed**: 2026-03-26
**Branch**: current working tree

### Summary

`deriveWorkspaceKey(...)` now uses synchronous Noble HKDF with the same HKDF-SHA256 contract as the old Web Crypto implementation: empty salt, `workspace:${workspaceId}` info, and 32-byte output. `workspace.encryption.activate(...)` now derives and applies the runtime workspace key synchronously, then awaits cache persistence separately.

The old HKDF race guard is gone. In its place, the workspace uses a smaller serialized persistence path plus a lightweight version token so `userKeyCache.save()` and `userKeyCache.clear()` converge on the latest lifecycle event without re-introducing async derivation complexity.

### What Changed

- Swapped async Web Crypto HKDF for sync `@noble/hashes` HKDF in `packages/workspace/src/shared/crypto/index.ts`.
- Added fixed-input compatibility coverage that compares sync HKDF output against the previous Web Crypto HKDF contract in `packages/workspace/src/shared/crypto/crypto.test.ts`.
- Refactored the workspace encryption controller to split runtime key state from persisted-key state and serialize cache save/clear ordering in `packages/workspace/src/workspace/create-workspace.ts`.
- Rewrote encryption lifecycle tests around sync runtime activation and cache ordering in `packages/workspace/src/workspace/create-workspace.test.ts`.
- Updated public encryption docs in `packages/workspace/src/workspace/types.ts`.

### Verification

- `bun test src/shared/crypto/crypto.test.ts src/workspace/create-workspace.test.ts`
- `bun run typecheck`
  - This still fails because of pre-existing type errors outside this HKDF change set, including files under `packages/sync-client/src/provider.ts`, `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`, `packages/workspace/src/timeline`, and existing `packages/workspace` extension/type tests.
