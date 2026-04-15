# Workspace Auth Layering

**Date**: 2026-03-25
**Status**: Implemented
**Author**: Codex
**Branch**: `feat/sync-auto-reconnect`

## Overview

Split the current shared auth factory into explicit layers: a generic session auth layer for Better Auth clients like Zhongwen, and a workspace auth wrapper for Epicenter apps where "signed in" means "workspace decrypted and usable."

## Motivation

### Current State

`packages/svelte-utils/src/auth-state.svelte.ts` currently owns Better Auth transport setup, token persistence, the phase machine, custom strategies, and workspace encryption lifecycle in one factory:

```typescript
export const authState = createAuthState({
	baseURL: APP_URLS.API,
	storage: createLocalStorage('honeycrisp'),
	strategies: { signInWithGoogle: googleRedirect },
	encryption: {
		activate: (key) => workspace.activateEncryption(base64ToBytes(key)),
		deactivate: () => workspace.deactivateEncryption(),
	},
});
```

The Chrome extension adds more app-specific behavior on top:

```typescript
export const authState = createAuthState({
	baseURL: () => remoteServerUrl.current,
	storage: {
		token: authToken,
		user: authUser,
		whenReady: Promise.all([authToken.whenReady, authUser.whenReady]),
	},
	strategies: { signInWithGoogle: chromeGoogleStrategy },
	encryption: {
		activate: (key) => workspace.activateEncryption(base64ToBytes(key)),
		deactivate: () => workspace.deactivateEncryption(),
		restoreFromCache: restoreEncryptionFromCache,
	},
});
```

This creates a few problems:

1. **The shared factory is lying about its scope**: the name suggests generic auth, but it already knows about Epicenter workspace encryption.
2. **Transport, storage, and orchestration are coupled**: Better Auth client setup, token rotation, storage persistence, sign-in flows, and workspace lifecycle all live in one module.
3. **The storage abstraction is too raw**: callers pass reactive cells instead of a real session store API, which pushes external sync concerns into app code.
4. **Dynamic strategies blur the public API**: each app gets different methods injected at runtime instead of depending on an explicit transport contract.

### Desired State

The layering should match the actual domain:

```typescript
const authApi = createWebAuthApi({ baseURL: APP_URLS.API });

const sessionStore = createLocalSessionStore('zhongwen');

export const authState = createSessionAuthState({
	authApi,
	sessionStore,
});
```

Workspace apps should use a stronger wrapper:

```typescript
const authApi = createWebAuthApi({ baseURL: APP_URLS.API });

const sessionStore = createLocalSessionStore('honeycrisp');

export const authState = createWorkspaceAuthState({
	authApi,
	sessionStore,
	workspace,
});
```

The extension should add one more dependency for instant decrypt-on-reopen:

```typescript
export const authState = createWorkspaceAuthState({
	authApi,
	sessionStore,
	workspace,
	restoreUserKey: async () => {
		const cached = await keyCache.load();
		return cached ? base64ToBytes(cached) : null;
	},
});
```

## Research Findings

### Workspace sign-out is a destructive teardown

The workspace contract already treats sign-out as a data teardown, not a cosmetic state flip.

| File | Behavior | Implication |
| --- | --- | --- |
| `packages/workspace/src/workspace/create-workspace.ts` | `deactivateEncryption()` clears keys, deactivates stores, runs `clearDataCallbacks`, then `onDeactivate` | Signed-out should mean the decrypted workspace is gone |
| `packages/workspace/src/workspace/types.ts` | Docs describe sign-out as "deactivate → clear stores → wipe IndexedDB" | Workspace lifecycle is part of product auth semantics |
| `apps/tab-manager/src/lib/workspace/client.svelte.ts` | Key cache save/clear already lives in workspace encryption hooks | Auth should not also own cache persistence |

**Key finding**: auth and workspace access are coupled in Epicenter's encrypted apps, but not in Zhongwen.

**Implication**: we need two layers, not one "generic" factory with optional workspace callbacks.

### The repo already has one generic consumer

`apps/zhongwen/src/lib/auth.ts` uses the shared auth factory without any workspace dependency.

**Key finding**: we cannot replace the current factory with a workspace-only API without stranding Zhongwen.

**Implication**: the redesign should introduce a generic session auth primitive, then layer workspace auth on top of it.

### Dynamic strategies are solving an auth API problem

The existing `strategies` config is used for two very different concerns:

| App | Strategy | Real concern |
| --- | --- | --- |
| Honeycrisp / Opensidian / Zhongwen | `googleRedirect` | Web Better Auth redirect auth API |
| Tab manager | `chromeGoogleStrategy` | Extension-specific OAuth auth API |

**Key finding**: the variability is in how requests are made, not in how the auth state machine should behave.

**Implication**: sign-in methods should live on an auth API object, not be dynamically added to the state store.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Generic auth primitive | `createSessionAuthState` | Keeps Zhongwen and other non-workspace apps on a clean auth layer |
| Workspace auth primitive | `createWorkspaceAuthState` | Makes the product invariant explicit for encrypted workspace apps |
| Better Auth integration | Move into explicit auth API helpers | Keeps provider details out of the state/controller layer |
| Session persistence | Introduce a `SessionStore` interface | Replaces raw reactive cells with a real persistence/sync boundary |
| Google sign-in | Expose explicit auth API methods such as `signInWithGoogle()` | Keeps the public API explicit and typed |
| Backward compatibility | Migrate current in-repo consumers to new names; keep changes local to this repo | Prefer clarity over preserving an ambiguous name internally |

## Architecture

This is the target layering:

```text
┌───────────────────────────────────────────────┐
│ Better Auth Transport                         │
│                                               │
│ signInWithEmail                               │
│ signUpWithEmail                               │
│ signInWithGoogle                              │
│ signOut                                       │
│ getSession                                    │
└───────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Session Store                                 │
│                                               │
│ ready                                         │
│ read()                                        │
│ write(session)                                │
│ clear()                                       │
│ subscribe(listener)?                          │
└───────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Session Auth State                            │
│                                               │
│ phase machine                                 │
│ session validation policy                     │
│ auth-aware fetch                              │
│ explicit auth methods                         │
└───────────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
┌───────────────────────┐  ┌──────────────────────────┐
│ Zhongwen              │  │ Workspace Auth State     │
│                       │  │                          │
│ uses generic session  │  │ wraps session auth and   │
│ auth directly         │  │ drives workspace decrypt │
└───────────────────────┘  └──────────────────────────┘
                                        │
                                        ▼
                           ┌──────────────────────────┐
                           │ Encrypted Workspace      │
                           │                          │
                           │ activateEncryption(key)  │
                           │ deactivateEncryption()   │
                           └──────────────────────────┘
```

Auth method ownership should also become explicit:

```text
Before
──────
createAuthState({
  strategies: { signInWithGoogle }
})
  -> state store grows methods dynamically

After
─────
createWebAuthApi()
  -> signInWithGoogle is part of authApi

createSessionAuthState({ authApi, sessionStore })
  -> state store exposes stable, explicit methods
```

## Implementation Plan

### Phase 1: Foundation

- [x] **1.1** Add a `SessionStore` abstraction with localStorage and reactive-cell adapters.
- [x] **1.2** Add Better Auth auth API helpers with explicit auth methods.
  > **Note**: The shared package now exports `createWebAuthApi()` and
  > the lower-level `createAuthApi()`. The extension-specific Google
  > popup flow stays in tab-manager because the shared package should not depend
  > on the `browser` extension global.
- [x] **1.3** Add shared session/auth types and JSDoc that explain the authApi/store/controller split.

### Phase 2: New auth state layers

- [x] **2.1** Replace the current monolithic factory with `createSessionAuthState`.
- [x] **2.2** Add `createWorkspaceAuthState` as a domain-specific wrapper over session auth.
- [x] **2.3** Keep auth-aware fetch and offline session validation behavior in the generic layer.
  > **Note**: `checkSession()` no longer hard-requires a local bearer token before
  > asking the server for session state. That keeps cookie-backed flows viable.

### Phase 3: App migration

- [x] **3.1** Migrate Opensidian and Honeycrisp to `createWorkspaceAuthState`.
- [x] **3.2** Migrate tab-manager to `createWorkspaceAuthState` with `restoreUserKey`.
- [x] **3.3** Migrate Zhongwen to `createSessionAuthState`.
- [x] **3.4** Update package docs/JSDoc references and app-level comments to match the new architecture.

### Phase 4: Verification and review

- [ ] **4.1** Run type-check for touched packages/apps.
  > **Note**: Verification is partially blocked by pre-existing repo issues outside
  > this auth refactor. `bun typecheck` fails in `apps/fuji` due a tsconfig parse
  > error, and targeted app checks also report unrelated baseline errors in
  > `packages/workspace` and `packages/ui`.
- [x] **4.2** Update the spec with implementation notes and review summary.

## Edge Cases

### OAuth redirect on the web

1. `signInWithGoogle()` triggers a redirect and never returns normally.
2. The app reloads later and calls `checkSession()`.
3. The generic session auth layer should still hydrate user/token state correctly without any workspace assumptions.

### Extension reopen with cached key

1. The extension sidebar opens with cached auth state and a cached user key.
2. `createWorkspaceAuthState` should restore decryption from cache before the server roundtrip.
3. `getSession()` should still run and replace the key with the authoritative server value when present.

### Server unreachable during session check

1. The app has cached session state.
2. `getSession()` fails with a network error or 5xx.
3. Generic session auth should keep the cached session; workspace auth should preserve the already-restored decrypted state.

### Auth rejection during session check

1. The app has cached state but the server rejects the session.
2. Session storage should be cleared.
3. Workspace auth should call `workspace.deactivateEncryption()` so local decrypted data is torn down.

## Open Questions

1. **Should we keep `createAuthState` as a deprecated alias?**
   - Options: (a) remove it entirely, (b) keep it as an alias to `createSessionAuthState`, (c) keep it as a compatibility wrapper with warnings
   - **Recommendation**: remove it from in-repo usage now and only keep an alias if the implementation ends up materially simpler with one.

2. **How much of the old storage-cell API should survive?**
   - The extension already has useful reactive storage wrappers.
   - **Recommendation**: keep the reactive wrappers, but adapt them into `SessionStore` at the auth boundary rather than letting the auth layer manipulate cells directly.

## Success Criteria

- [ ] Workspace apps no longer pass encryption callback bags into a generic auth factory.
- [ ] Zhongwen uses a generic session auth layer with no workspace dependency.
- [ ] Google sign-in methods come from auth API helpers, not dynamic strategy injection.
- [ ] Storage flows through a real `SessionStore` abstraction instead of ad hoc token/user cells.
- [ ] Public auth APIs and app wrappers have clear JSDoc with realistic examples.
- [ ] Type-check passes for the touched code.

## References

- `packages/svelte-utils/src/auth-state.svelte.ts`
- `apps/tab-manager/src/lib/state/auth.svelte.ts`
- `apps/tab-manager/src/lib/state/storage-state.svelte.ts`
- `apps/tab-manager/src/lib/workspace/client.svelte.ts`
- `apps/opensidian/src/lib/auth/index.ts`
- `apps/honeycrisp/src/lib/auth/index.ts`
- `apps/zhongwen/src/lib/auth.ts`
- `packages/workspace/src/workspace/create-workspace.ts`
- `packages/workspace/src/workspace/types.ts`

## Review

**Completed**: 2026-03-25
**Branch**: `feat/sync-auto-reconnect`

### Summary

The auth module was split into the layers this spec proposed. `packages/svelte-utils/src/auth-state.svelte.ts` now exports explicit `SessionStore` helpers, Better Auth auth APIs, a generic `createSessionAuthState()`, and the domain-specific `createWorkspaceAuthState()` wrapper for encrypted workspace apps.

The app boundary is now clearer. Zhongwen uses generic session auth, while Opensidian, Honeycrisp, and tab-manager use workspace auth. Tab-manager no longer needs manual auth watchers for cross-context sign-in/sign-out; that concern moved into the `SessionStore` boundary.

### Deviations from Spec

- The shared package does not export an extension-specific auth API helper. Instead it exports `createAuthApi()` and tab-manager provides the Chrome OAuth implementation locally. This keeps `@epicenter/svelte` free of `browser` globals.
- The old `createAuthState` name was removed from in-repo usage immediately rather than kept as a compatibility alias.

### Follow-up Work

- Clear the unrelated repo-wide type-check failures in `apps/fuji`, `packages/workspace`, and `packages/ui`, then rerun full verification.
- Decide whether external consumers of `@epicenter/svelte/auth-state` need a temporary compatibility alias for `createAuthState`.
