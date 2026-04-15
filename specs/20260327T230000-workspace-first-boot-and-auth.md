# Workspace-First Boot And Auth

**Date**: 2026-03-27
**Status**: Implemented
**Author**: AI-assisted
**Branch**: feat/sync-auto-reconnect

## Overview

Epicenter should boot around workspace usability, not auth session readiness. The app must render immediately in either plaintext mode or unlocked mode, while network auth runs in parallel and only controls sync, protected API access, and key fetch.

## Motivation

### Current State

Today the apps gate first render on auth initialization, and workspace unlock hangs off auth session commits.

```text
auth boot
  -> maybe resolve session
  -> maybe fetch encryptionKey
  -> maybe unlock workspace
  -> render app
```

This is visible in the app entrypoints:

- `apps/honeycrisp/src/routes/+page.svelte`
- `apps/opensidian/src/routes/+page.svelte`
- `apps/zhongwen/src/routes/+page.svelte`
- `apps/tab-manager/src/entrypoints/sidepanel/App.svelte`

The workspace layer already supports a simpler model:

```text
no key
  -> writes stay plaintext

key arrives later
  -> activateEncryption()
  -> rewrite old plaintext values as encrypted
  -> future writes are encrypted
```

That behavior exists today in:

- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`
- `packages/workspace/src/workspace/create-workspace.ts`

This creates problems:

1. Auth is treated as the center of the app even though local workspace availability is the real product capability.
2. The storage layer already supports plaintext-first and encrypt-later behavior, but the boot flow does not model that explicitly.
3. Web auth persistence currently outlives key persistence, which creates a confusing mismatch.
4. The current design makes it harder to reason about what is needed for local access versus network access.

### Desired State

```text
workspace boot
  -> if key exists: unlocked mode
  -> else: plaintext mode
  -> render app immediately

network auth
  -> anonymous or authenticated
  -> only affects sync / protected APIs / key fetch
```

## Research Findings

### What the code does today

| Area | Current behavior | Implication |
| --- | --- | --- |
| Workspace storage | Without a key, encrypted stores write plaintext values | Anonymous local writing is already possible |
| Unlock path | `activateEncryption()` rewrites existing plaintext entries as encrypted blobs | Encrypt-later is already supported |
| Auth boot | App shells wait on `authState.whenReady` | Auth is still the UI gate |
| Sign out | App auth hooks clear local data on auth loss | Full local reset is already close to current behavior |
| Web key cache | Raw user key is cached in `sessionStorage` today | Restart currently re-locks encrypted data on web |
| Server contract | `getSession()` returns `encryptionKey` and `keyVersion` | Better Auth currently acts as both auth layer and key vending path |

### Key finding

The storage layer is already closer to the product we want than the app lifecycle is.

### Implication

This redesign is mostly about boot flow, ownership boundaries, and semantics. It is not primarily a crypto rewrite.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| App shell center | Workspace availability | Better matches local-first product behavior |
| Workspace public mode | `plaintext` or `unlocked` | Small, stable model |
| Network public mode | `anonymous` or `authenticated` | Small, stable model |
| Anonymous local writes | Allowed | Already supported by storage layer |
| Login after anonymous local use | Adopt existing local data into the account and encrypt it in place | Simplest and most consistent user model |
| Sign out semantics | Full local clear | Safe, explicit, and already close to current behavior |
| Web raw key persistence across browser restart | Do not persist by default | Better security default for browser environments |
| Plaintext mode sync behavior | Local-only | Avoid ambiguous half-authenticated behavior |
| Account switching in phase 1 | Treat as sign out followed by new login | Smallest policy surface for initial rollout |
| Future remembered-device support | Deferred | Requires stronger storage and device-trust story |
| Key rotation redesign | Deferred | Keep this spec focused on boot and unlock semantics |

## Architecture

The core split is between local workspace availability and network capability.

```text
+---------------------+          +----------------------+
|  local workspace    |          |   network session    |
+---------------------+          +----------------------+
| mode: plaintext     |          | mode: anonymous      |
| or unlocked         |          | or authenticated     |
|                     |          |                      |
| controls local      |          | controls sync, API,  |
| read/write          |          | and key fetch        |
+---------------------+          +----------------------+
            |                                 |
            +---------------+-----------------+
                            |
                            v
                 +--------------------------+
                 |      app experience      |
                 +--------------------------+
                 | render immediately       |
                 | use local workspace      |
                 | attach identity later    |
                 +--------------------------+
```

### Boot flow

```text
APP BOOT
   |
   +--> check cached key
   |      |
   |      +--> key found
   |      |      |
   |      |      +--> workspace mode = unlocked
   |      |
   |      +--> no key
   |             |
   |             +--> workspace mode = plaintext
   |
   +--> render app immediately
   |
   +--> resolve network auth in parallel
          |
          +--> authenticated
          |      |
          |      +--> enable sync / protected APIs / fresh key fetch
          |
          +--> anonymous
                 |
                 +--> local app still usable
```

### Write before login

```text
user opens app
   |
   +--> no cached key
   |
   +--> workspace mode = plaintext
   |
   +--> user writes notes/data
   |
   +--> local data stored as plaintext
   |
   +--> app remains usable without auth
```

### Login after plaintext data exists

```text
plaintext local data exists
   |
   +--> user logs in
   |
   +--> server returns token + encryptionKey
   |
   +--> network mode = authenticated
   |
   +--> workspace.unlock(userKey)
           |
           +--> derive workspace key
           +--> activate encryption
           +--> rewrite old plaintext entries as encrypted
           +--> future writes now encrypted
   |
   +--> local data remains available throughout
```

### Sign out

```text
user clicks sign out
   |
   +--> revoke/remove auth token
   +--> clear cached key
   +--> clear local workspace data
   |
   +--> workspace mode = plaintext
   +--> network mode = anonymous
```

## Why these defaults

### 1. Sign out clears local data

This is the simplest and most internally consistent behavior.

```text
sign out = leave this device clean
```

It avoids a blurry middle state where the user is signed out but old encrypted or plaintext local data is still hanging around. It also matches the current app-level behavior closely enough that the migration is conceptual, not shocking.

### 2. Web restart should not persist the raw key by default

This is the simplest and safest browser default.

If the raw user key survives a full browser restart in normal web storage, then encryption-at-rest becomes much less meaningful on shared or compromised devices. The UX is better, but the security story gets fuzzier fast.

The clean default is:

```text
web browser restart
  -> keep auth session if needed
  -> do not keep raw user key by default
  -> encrypted workspace relocks
```

That gives the browser a clear rule: closing the browser drops the unlock capability. It also matches the current web behavior, where the key cache is session-scoped.

This can stay different on richer platforms:

```text
web
  -> conservative default

desktop / mobile
  -> future option to persist via OS secure storage
```

### 3. Login should adopt existing local plaintext data and encrypt it

This is the simplest and most consistent product rule.

If anonymous local usage is a real mode, then logging in should not feel like switching to a different universe. The local workspace the user already started should become their authenticated encrypted workspace unless we deliberately design a more complex account-attachment flow.

The clean rule is:

```text
pre-login local data belongs to this device-local workspace
login attaches identity to that workspace
unlock encrypts existing plaintext entries in place
future writes stay encrypted
```

That is also what the storage layer naturally supports today. Anything more complicated, like prompting to merge, fork, or discard on first login, would be a more advanced product flow. It is not the simplest phase 1.

## Public Model

Keep the public model small.

```ts
type WorkspaceMode = 'plaintext' | 'unlocked';
type NetworkMode = 'anonymous' | 'authenticated';
```

Everything else should be operational detail:

```ts
isBooting
isSigningIn
isRefreshingAuth
isEncryptingExistingData
isSigningOut
```

## Execution Readiness

This spec is ready to implement without additional product decisions for phase 1.

The following points are intentionally locked in:

```text
- workspace-first boot is the shell
- plaintext mode is a real first-class local mode
- plaintext mode is local-only
- login adopts existing local plaintext data and encrypts it in place
- sign out performs a full local clear
- web does not persist the raw user key across full browser restart by default
- account switching is treated as sign out + new login in phase 1
- key rotation is deferred
```

There are still good follow-up questions, but none of them should block the first implementation pass.

## Implementation Plan

### Phase 1: Specify and separate responsibilities

- [x] **1.1** Define a workspace-first lifecycle module or store that owns workspace boot and mode
  > **Implemented**: `createWorkspaceFirstBoot()` now owns cached-key boot, network auth refresh, workspace/network modes, login unlock, and sign-out wipe behavior.
- [x] **1.2** Reduce auth state to network capability and key delivery responsibilities
  > **Implemented**: app auth modules no longer unlock or clear the workspace directly; they only resolve sessions, tokens, and key delivery through auth commits.
- [x] **1.3** Document exact sign-out behavior as full local clear
  > **Implemented**: the shared coordinator only performs `workspace.clearLocalData()` on explicit `sign-out` commits, preserving local usability across non-sign-out auth changes.
- [x] **1.4** Document adoption semantics for plaintext local data on first login
  > **Implemented**: login-triggered unlock now runs through the shared coordinator, which preserves local plaintext data and relies on `activateEncryption()` to rewrite it in place.

### Phase 2: Change app boot flow

- [x] **2.1** Stop gating app shells on `authState.whenReady`
- [x] **2.2** Boot workspace first and choose `plaintext` or `unlocked`
- [x] **2.3** Resolve network auth in parallel after local workspace boot

### Phase 3: Wire login to encrypt-later behavior

- [x] **3.1** On successful login, fetch user key and unlock workspace
- [x] **3.2** Ensure existing plaintext entries are encrypted in place
- [x] **3.3** Keep future writes encrypted once unlocked

### Phase 4: Align platform persistence and cleanup

- [x] **4.1** Preserve session-scoped raw key caching on web as the default
- [x] **4.2** Audit extension and desktop storage to align with explicit platform policies
  > **Implemented**: this pass kept the existing session-scoped browser and extension caches intact and did not introduce any richer raw-key persistence path.
- [x] **4.3** Defer remembered-device support until storage and trust model are specified
- [x] **4.4** Treat account switching as sign out + new login and avoid introducing merge/fork policy in this phase

## Edge Cases

### Anonymous local data exists, then user logs in

1. User creates local plaintext data before login.
2. User logs in successfully.
3. Existing local plaintext data is encrypted in place and kept.

### Browser restart on web after prior encrypted usage

1. User had an unlocked encrypted workspace during the last browser session.
2. Browser fully restarts.
3. Raw key is not restored by default.
4. Workspace reopens in plaintext mode unless the user logs in again and fetches a key.

### Sign out while local data exists

1. User is authenticated and has local workspace data.
2. User signs out.
3. Token, cached key, and local workspace persistence are all cleared.

### Different account logs in later on the same device

1. Device has local plaintext data from anonymous usage.
2. A user logs in.
3. The current phase 1 behavior is to adopt that local data into the authenticated workspace and encrypt it.

This is intentionally simple. More advanced account-switching policy is out of scope for this spec.

## Unresolved Questions

These are real follow-up topics, but this phase should not solve them. Writing them down here is mainly about protecting scope.

1. How should key rotation work?

   This phase should not solve key rotation. `keyVersion` can remain metadata until we write a dedicated rotation design.

2. Should web support an explicit remembered-device unlock flow across browser restarts?

   This phase should not introduce remembered-device behavior on web. The browser default stays conservative: restart drops raw-key unlock.

3. What should happen if device-local data and account identity do not line up cleanly?

   This phase should not invent merge, fork, discard, or account-attachment UX beyond the simple rules already in this spec. Phase 1 keeps the model small: login adopts the current local workspace, and account switching is still sign out followed by new login.

4. Could plaintext mode ever participate in sync?

   Plaintext mode must stay local-only. If we ever want an unauthenticated or partially authenticated sync story, that needs its own product and security spec.

5. Should desktop and mobile persist the raw user key in OS-backed secure storage?

   Probably yes, but that is a platform-specific follow-up, not part of this phase.

## Review

**Completed**: 2026-03-27
**Branch**: feat/sync-auto-reconnect

### Summary

The shared auth/workspace boundary now boots around local workspace usability instead of auth readiness. A new `createWorkspaceFirstBoot()` primitive boots from the cached key when available, falls back to plaintext mode otherwise, refreshes network auth in parallel, and handles login unlock plus explicit sign-out wipe from one place.

The affected app shells no longer await `authState.whenReady` before rendering. Honeycrisp, Opensidian, Zhongwen, and the tab-manager sidepanel now start the shared boot coordinator on mount and continue using auth only for network capabilities, protected API access, and key delivery.

### Deviations From Spec

- No new desktop storage implementation was needed in this pass because the affected entrypoints were browser and extension surfaces. The desktop persistence policy remains deferred rather than expanded.
- Sign-out wipe is now attached to explicit `sign-out` commits instead of any transition from authenticated to anonymous. That is a deliberate correction: wiping on bootstrap/refresh auth loss would have broken the workspace-first model by destroying local usability when network auth disappears.

### Verification

- `bun test packages/svelte-utils/src/workspace-first-boot.test.ts`
- Targeted package/app typecheck commands still fail in this repository because of substantial pre-existing TypeScript and package-resolution issues outside this spec's change set. The new coordinator test coverage passed, but full type health remains a separate cleanup track.

### Follow-up Work

- Add cross-tab sign-out intent propagation if we want explicit sign-out in one tab to force a full local wipe in other open tabs without also wiping on ordinary auth expiry.
- Clean up the existing `@epicenter/svelte`, `@epicenter/workspace`, `@epicenter/ui`, and app-level typecheck debt so future spec work can rely on meaningful green typecheck gates.
