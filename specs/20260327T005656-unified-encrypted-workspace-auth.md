# Unified Encrypted Workspace Auth

**Date**: 2026-03-27
**Status**: In Progress
**Author**: Codex

## Overview

Collapse the remaining split between plain auth and workspace auth. All authenticated apps should use encrypted workspaces, and the shared Svelte auth module should expose one high-level constructor that always coordinates session state with workspace unlock and local-data clearing.

## Motivation

### Current State

The repo still has two product shapes.

Shared auth assumes workspace-coupled encryption:

```ts
export function createWorkspaceAuth({
	baseURL,
	token,
	user,
	workspace,
	signInWithGoogle,
}: {
	baseURL: string | (() => string);
	token: SessionFieldState<string | null>;
	user: SessionFieldState<StoredUser | null>;
	workspace: WorkspaceAuthHandle;
	signInWithGoogle?: (...args: never[]) => Promise<unknown>;
}): WorkspaceAuth;
```

Zhongwen still runs its own plain auth controller and a non-encrypted workspace:

```ts
export const workspace = createWorkspace(definition)
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('broadcast', broadcastChannelSync);
```

```ts
function createAuth() {
	let pendingAction = $state<PendingAction>('bootstrapping');
	// separate status machine, refresh flow, fetch wrapper, Google flow
}
```

This creates problems:

1. **Duplicated auth flow**: Zhongwen owns its own phase machine, Better Auth client wiring, redirect handling, and refresh semantics.
2. **Two meanings of sign-out**: workspace apps clear local encrypted data on sign-out; Zhongwen currently keeps local IndexedDB data outside auth.
3. **API drift pressure**: any future auth fix must be made in both the shared controller and Zhongwen's fork.
4. **Soft product invariant**: the repo already treats authenticated workspace apps as encrypted-by-default, but the API still makes that read like an optional variant.

### Desired State

All authenticated apps use the same top-level API:

```ts
export const authState = createAuth({
	baseURL: APP_URLS.API,
	token,
	user,
	workspace,
});
```

The workspace remains the low-level owner of encryption mechanics:

```ts
export const workspace = createWorkspace(definition)
	.withEncryption({ userKeyCache })
	.withExtension('persistence', indexeddbPersistence)
	.withExtension('broadcast', broadcastChannelSync);
```

The auth layer owns session lifecycle and calls into the workspace to unlock, try unlock, and clear local data.

## Research Findings

### What the current code actually separates

The shared auth controller already owns the real cross-app behavior:

| Concern | Shared auth | Zhongwen local auth |
| --- | --- | --- |
| Bootstrap state machine | Yes | Yes |
| Better Auth token issuance handling | Yes | Yes |
| Auth-aware `fetch` | Yes | Yes |
| Session refresh semantics | Yes | Yes |
| Google redirect interruption handling | Yes | Yes |
| Workspace unlock on authenticated session | Yes | No |
| Local-data clear on sign-out | Yes | No |
| External session watch for extension storage | Yes | No |

Key finding: the duplication is not around app-specific UI. It is the auth controller itself.

Implication: we should remove the plain-auth fork, not keep polishing two controllers.

### What encryption changes in practice

Workspace encryption is not just "store bytes encrypted." The current library contract is:

```ts
workspace.encryption.unlock(userKey)
workspace.encryption.tryUnlock()
workspace.encryption.lock()
workspace.clearLocalData()
```

`clearLocalData()` locks first, wipes persistence, and clears the configured user-key cache. `tryUnlock()` only exists when a `userKeyCache` is configured.

Key finding: the runtime overhead is small, but the lifecycle semantics are not. Encryption changes startup, sign-out, and what local persistence means.

Implication: if we force encryption everywhere, Zhongwen's local chat data becomes auth-owned local data by design.

### Existing server contract

The API already returns `encryptionKey` in custom session fields:

```ts
customSession(async ({ user, session }) => {
	const encryptionKey = await deriveUserKey(currentKey.secret, user.id);
	return {
		user,
		session,
		encryptionKey: bytesToBase64(encryptionKey),
		keyVersion: currentKey.version,
	};
})
```

Key finding: the server already emits the root key material needed to unlock every authenticated workspace.

Implication: we do not need a new auth protocol to make Zhongwen encrypted.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| High-level auth API | One public `createAuth(...)` constructor | Matches the new product invariant: authenticated apps are encrypted workspace apps |
| Workspace requirement | `workspace` is required | Auth now always coordinates unlock and sign-out data clearing |
| Workspace API ownership | Keep encryption mechanics in `@epicenter/workspace` | Prevents the Svelte auth layer from becoming the crypto abstraction layer |
| Startup contract | Add `whenReady` and keep `refreshSession()` | `whenReady` matches how apps already use `bootstrap()` as a render gate |
| Manual subscription API | Remove `subscribe()` if no implementation dependency remains | Repo callsites read reactive getters directly; manual listener plumbing is dead weight |
| Zhongwen persistence | Encrypt workspace and add a user-key cache | Preserves local-first startup instead of forcing a network roundtrip before unlock |
| External session sync | Keep optional `watch` on session fields | Chrome extension storage has real cross-context session changes |

## Architecture

The target layering is:

```text
┌──────────────────────────────────────────────┐
│ @epicenter/svelte/auth                       │
│                                              │
│ createAuth({ baseURL, token, user, workspace │
│            signInWithGoogle? })              │
│                                              │
│ - bootstrap / whenReady                      │
│ - refreshSession                             │
│ - sign in / sign up / sign out               │
│ - auth-aware fetch                           │
│ - workspace unlock and clearLocalData        │
└──────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│ @epicenter/workspace                         │
│                                              │
│ createWorkspace(...).withEncryption(...)     │
│                                              │
│ - encryption.unlock(userKey)                 │
│ - encryption.tryUnlock()                     │
│ - encryption.lock()                          │
│ - clearLocalData()                           │
└──────────────────────────────────────────────┘
```

Startup flow:

```text
STEP 1: local field readiness
─────────────────────────────
Await token.whenReady and user.whenReady if present.

STEP 2: local workspace unlock
──────────────────────────────
If a cached user exists and the workspace supports tryUnlock(), attempt unlock from the cached user key.

STEP 3: first render
────────────────────
Resolve auth.whenReady so the app can render against local session state.

STEP 4: server session refresh
──────────────────────────────
Call refreshSession() to validate the token and apply the latest user + encryption key from the API.
```

## Implementation Plan

### Phase 1: Shared auth API cleanup

- [x] **1.1** Rename the shared public constructor to `createAuth(...)` and keep the workspace requirement.
- [x] **1.2** Add `whenReady` to the returned auth object and switch the internal bootstrap promise to back that property.
- [x] **1.3** Remove the unused manual subscription API if no implementation dependency remains after the refactor.
- [x] **1.4** Keep the session-field seam minimal: `current`, optional `set`, optional `whenReady`, optional `watch`.

### Phase 2: Zhongwen migration

- [x] **2.1** Update Zhongwen's workspace client to use `.withEncryption({ userKeyCache })`.
- [x] **2.2** Add a Zhongwen user-key cache implementation for local-first unlock.
- [x] **2.3** Replace Zhongwen's local auth controller with the shared `createAuth(...)` call.
- [x] **2.4** Verify Zhongwen still boots from local state and still refreshes server auth on mount.

### Phase 3: Shared callsite migration

- [x] **3.1** Migrate Honeycrisp, Opensidian, and tab-manager imports to the renamed shared constructor.
- [x] **3.2** Keep tab-manager's custom Google flow and chrome storage behavior unchanged.
- [ ] **3.3** Update any docs or comments that still describe auth as two product shapes.

### Phase 4: Verification

- [ ] **4.1** Typecheck the touched packages and apps.
- [x] **4.2** Smoke test route-level render gates that currently use `bootstrap()`.
- [ ] **4.3** Confirm sign-out still clears local data for encrypted workspaces.

## Edge Cases

### Cached auth without cached user key

1. Token and user restore from persisted session fields.
2. Workspace has encryption enabled but no cached user key.
3. `whenReady` resolves from local auth fields, but local workspace data stays locked until `refreshSession()` succeeds.

Expected outcome: avoid this state for Zhongwen by configuring a user-key cache.

### External sign-out in the extension

1. Another extension context clears token/user.
2. `watch` fires in the active context.
3. Auth state goes signed-out and `workspace.clearLocalData()` runs.

Expected outcome: keep the existing watch-based behavior in tab-manager.

## Open Questions

1. **Should `bootstrap()` survive as an alias to `whenReady`, or should we force all callsites to move immediately?**
   - Options: (a) keep both temporarily, (b) replace with `whenReady` everywhere now
   - **Recommendation**: keep both for one pass if it lowers migration risk, then remove `bootstrap()` once all callsites have moved.

2. **Should `createAuth(...)` return `error` or keep `signInError`?**
   - `signInError` is inherited from the current UI contract, but the error now also covers refresh failures and external sign-out cleanup failures.
   - **Recommendation**: keep `signInError` for this pass to minimize churn; rename later only if the UI wants the broader meaning.

## Success Criteria

- [ ] All authenticated apps use encrypted workspaces.
- [ ] Zhongwen no longer owns a local auth controller.
- [ ] The shared auth module exposes one main public constructor for app auth.
- [ ] Route-level startup uses `whenReady` or a compatibility alias backed by the same promise.
- [ ] Sign-out still clears local encrypted data across apps.

## References

- `packages/svelte-utils/src/auth.svelte.ts` - current shared workspace auth controller
- `apps/zhongwen/src/lib/auth.ts` - duplicated plain auth controller to remove
- `apps/zhongwen/src/lib/workspace/client.ts` - current non-encrypted workspace
- `apps/honeycrisp/src/lib/auth/index.ts` - workspace-auth callsite
- `apps/opensidian/src/lib/auth/index.ts` - workspace-auth callsite
- `apps/tab-manager/src/lib/state/auth.svelte.ts` - extension auth callsite with custom Google flow
- `apps/tab-manager/src/lib/state/storage-state.svelte.ts` - real external session watch seam
- `packages/workspace/src/workspace/create-workspace.ts` - encryption lifecycle and clearLocalData behavior
- `apps/api/src/custom-session-fields.ts` - auth session fields contract

## Review

Implemented two cleanup passes of the unified encrypted-workspace auth rollout.

What changed:

- Added `createAuth(...)` as the main shared constructor in `packages/svelte-utils/src/auth.svelte.ts`.
- Added `whenReady` to the auth return shape while keeping `bootstrap()` as a compatibility alias for now.
- Migrated Honeycrisp, Opensidian, Zhongwen, and tab-manager to import `createAuth(...)`.
- Updated route-level render gates to read `authState.whenReady`.
- Switched Zhongwen's workspace to `.withEncryption({ userKeyCache })`.
- Added a Zhongwen browser `userKeyCache` implementation backed by `sessionStorage`.
- Removed the unused manual `subscribe()` path from shared auth.
- Removed the `createWorkspaceAuth` compatibility alias and the old `WorkspaceAuth*` compatibility types.
- Removed the `bootstrap()` compatibility method after migrating the route-level callsites.

Verification notes:

- `git diff --check` passed for the touched files.
- Repo-wide `bun run typecheck` / `bun run check` still fail because of many pre-existing errors in `packages/workspace`, `packages/ui`, and unrelated app files.
- Targeted greps over the typecheck output did not surface new diagnostics in the touched auth files.

Remaining follow-up:

- Do a runtime sign-out sanity pass to confirm `workspace.clearLocalData()` still behaves as expected in Zhongwen.
