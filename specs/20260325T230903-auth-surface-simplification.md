# Auth Surface Simplification

**Date**: 2026-03-25
**Status**: Implemented
**Author**: Codex
**Branch**: `feat/sync-auto-reconnect`

## Overview

Simplify `packages/svelte-utils/src/auth-state.svelte.ts` so the public API matches the real product shape: the top-level split should be domain-based (`createAuth` vs `createWorkspaceAuth`), while environment differences should be injected through concrete seams such as auth client and auth store. Remove the current framework-ish layering, especially `createAuthController`, and replace it with constructors whose names and call sites match how apps actually use auth in this repo.

## Motivation

### Current State

The current auth module is already better than the original callback soup, but it still exposes too much internal architecture at the public boundary.

Current call sites:

```typescript
// apps/zhongwen/src/lib/auth.ts
const authApi = createWebAuthApi({
	baseURL: APP_URLS.API,
});

const sessionStore = createLocalSessionStore('zhongwen');

export const authState = createSessionAuthState({
	authApi,
	sessionStore,
});
```

```typescript
// apps/honeycrisp/src/lib/auth/index.ts
const authApi = createWebAuthApi({
	baseURL: APP_URLS.API,
});

const sessionStore = createLocalSessionStore('honeycrisp');

export const authState = createWorkspaceAuthState({
	authApi,
	sessionStore,
	workspace,
});
```

```typescript
// apps/tab-manager/src/lib/state/auth.svelte.ts
const authApi = createAuthApi({
	baseURL: () => remoteServerUrl.current,
	signInWithGoogle: async (client) => {
		// extension-specific OAuth flow
	},
});

const sessionStore = createReactiveSessionStore({
	token: authToken,
	user: authUser,
	ready: Promise.all([authToken.whenReady, authUser.whenReady]),
});

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

The shared file still has these public concepts:

- `createWebAuthApi()`
- `createAuthApi()`
- `createLocalSessionStore()`
- `createReactiveSessionStore()`
- `createSessionAuthState()`
- `createWorkspaceAuthState()`

And internally the real engine is still a generic helper:

```typescript
function createAuthController(
	{ authApi, sessionStore }: SessionAuthStateConfig,
	lifecycle: InternalLifecycle,
) {
	// almost all logic lives here
}
```

This creates a few problems:

1. **The public API still reflects implementation layering instead of product usage**: most apps do not think in terms of `authApi + sessionStore + auth state constructor`; they think in terms of "plain auth" vs "workspace-coupled auth."
2. **`createAuthController` is a smell**: it owns nearly all behavior, while the public constructors are thin wrappers around it. That usually means the code is organized around an internal engine rather than real domain concepts.
3. **The real seams are narrower than the current API suggests**: the main differences we know today are session persistence and auth initiation flow, not the overall auth lifecycle.
4. **Tauri may introduce more platform-specific restore details later**: the abstraction should leave room for that without forcing a platform-specific constructor explosion up front.
5. **Some shapes are still awkward**: `AuthSession = { session, encryptionKey }` adds a nested `session.session.user` shape, and `authApi` is a reasonable name but still more architectural than product-facing.

### Desired State

The public API should make the domain split obvious:

```typescript
export const auth = createAuth({
	client: createWebAuthClient({ baseURL: APP_URLS.API }),
	store: createLocalAuthStore('zhongwen'),
});
```

```typescript
export const auth = createWorkspaceAuth({
	client: createWebAuthClient({ baseURL: APP_URLS.API }),
	store: createLocalAuthStore('honeycrisp'),
	workspace,
});
```

Environment differences should be injected through the same two seams:

```typescript
export const auth = createWorkspaceAuth({
	client: createExtensionAuthClient({
		baseURL: () => remoteServerUrl.current,
		signInWithGoogle: async (client) => {
			// extension-specific OAuth flow
		},
	}),
	store: createChromeAuthStore({
		token: authToken,
		user: authUser,
		ready: Promise.all([authToken.whenReady, authUser.whenReady]),
	}),
	workspace,
	restoreUserKey: async () => {
		const cached = await keyCache.load();
		return cached ? base64ToBytes(cached) : null;
	},
});
```

If Tauri needs extra behavior, that should still fit into the same model:

```typescript
export const auth = createWorkspaceAuth({
	client: createTauriAuthClient({ baseURL: APP_URLS.API }),
	store: createTauriAuthStore('opensidian'),
	workspace,
	restoreUserKey: async () => {
		// only if Tauri needs platform-specific restore semantics
	},
});
```

The public API should stay domain-based. Platform differences should live in the injected implementations, not in parallel top-level constructors.

## Research Findings

### The main environment differences are client and store behavior

Current in-repo consumers:

| App | Needs workspace decryption? | Storage style | Auth-init style |
| --- | --- | --- | --- |
| `apps/zhongwen` | No | localStorage | normal SPA / web redirect |
| `apps/honeycrisp` | Yes | localStorage | normal SPA / web redirect |
| `apps/opensidian` | Yes | localStorage | normal SPA / web redirect |
| `apps/tab-manager` | Yes | `chrome.storage` wrappers | extension-specific OAuth |

**Key finding**: the real differences today are mostly:

- how session state is persisted and synchronized
- how Google sign-in is initiated

The rest of the auth lifecycle is largely shared.

**Implication**: the top-level constructors should stay domain-based, while environment differences are injected through client/store implementations.

### Workspace auth is a real domain concept

The workspace client already documents and implements sign-out as a destructive teardown:

- `deactivateEncryption()` clears keys
- deactivates encrypted stores
- wipes persisted data via `clearDataCallbacks`
- runs workspace cleanup hooks

This means "workspace auth" is not just auth plus a callback; it is a real product-level lifecycle.

**Key finding**: `createWorkspaceAuth` is a defensible public concept.

**Implication**: keep a distinct workspace-aware constructor instead of hiding workspace decryption behind generic lifecycle hooks.

### `createAuthController` is the real engine, which is a warning sign

The current shared file exposes multiple constructors, but the real logic lives in one private function:

```typescript
function createAuthController(...) {
	// signIn
	// signUp
	// signInWithGoogle
	// signOut
	// checkSession
	// fetch
	// store sync
	// lifecycle hooks
}
```

**Key finding**: the internal abstraction is doing more conceptual work than the public constructors.

**Implication**: either rename that internal concept to a real domain term or, preferably, eliminate it and let the public constructors read like the actual product concepts.

### The remaining DI seams are small and concrete

Even after simplification, two seams remain useful:

| Seam | Why it exists | Web / SPA case | Extension case | Possible Tauri case |
| --- | --- | --- | --- |
| auth client | Web redirect vs extension OAuth popup | Better Auth redirect client | Better Auth client + custom Google flow | Better Auth client + native/deep-link flow if needed |
| auth store | localStorage vs `chrome.storage` wrappers | simple storage key | reactive cell adapter with subscribe | native/secure storage if needed |
| optional restore hook | some environments can restore decrypt state before server validation | often unnecessary | used for cached user key restore | may be needed if native storage/bootstrap differs |

**Key finding**: dependency injection is still useful, primarily for client and store. A restore hook remains a valid optional seam for workspace auth if a platform needs it.

**Implication**: keep the public API focused on `createAuth` and `createWorkspaceAuth`, and inject environment-specific behavior through those narrower seams.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Top-level generic auth name | `createAuth` | Short, obvious, and describes the domain concept directly |
| Top-level workspace auth name | `createWorkspaceAuth` | Keeps the meaningful distinction that signed-in implies decrypted workspace access |
| Public platform split | Do not add platform-specific top-level constructors | Platform mostly changes infrastructure, not auth domain semantics |
| Better Auth helper names | `createWebAuthClient`, `createExtensionAuthClient`, `createTauriAuthClient` | Makes platform-specific auth initiation explicit at the helper layer |
| Store helper names | `createLocalAuthStore`, `createChromeAuthStore`, `createTauriAuthStore` | Makes persistence/sync differences explicit at the helper layer |
| Central internal helper | Remove `createAuthController` | Inline logic into public constructors or extract only small focused helpers |
| Auth result shape | Flatten to `{ user, token, encryptionKey? }` | Avoid nested `session.session.user` shape |
| Public constructor inputs | `client` + `store`, plus `workspace` / `restoreUserKey?` for workspace auth | Keeps domain API stable while letting platforms vary underneath |

## Proposed API

### Public API

```typescript
export function createAuth({
	client,
	store,
}: {
	client: AuthClient;
	store: AuthStore;
}) { ... }

export function createWorkspaceAuth({
	client,
	store,
	workspace,
	restoreUserKey,
}: {
	client: AuthClient;
	store: AuthStore;
	workspace: WorkspaceHandle;
	restoreUserKey?: () => Promise<Uint8Array | null>;
}) { ... }
```

### Internal API

```typescript
type AuthClient = {
	signIn(credentials: EmailSignInCredentials): Promise<AuthResult>;
	signUp(credentials: EmailSignUpCredentials): Promise<AuthResult>;
	signInWithGoogle(): Promise<AuthResult>;
	signOut(token: string | null): Promise<void>;
	getSession(token: string | null): Promise<AuthResult | null>;
};

type AuthStore = {
	ready: Promise<void>;
	read(): SessionSnapshot;
	write(snapshot: SessionSnapshot): void | Promise<void>;
	clear(): void | Promise<void>;
	subscribe?(listener: (snapshot: SessionSnapshot) => void): () => void;
};

type AuthResult = {
	user: StoredUser;
	token: string | null;
	encryptionKey?: string | null;
};
```

## Architecture

The target architecture should read like this:

```text
createAuth
  ├── injected client
  ├── injected store
  └── returns auth state

createWorkspaceAuth
  ├── injected client
  ├── injected store
  ├── workspace dependency
  ├── optional restoreUserKey
  └── returns workspace-aware auth state
```

Platform helpers feed those constructors:

```text
Web / SPA
  createWebAuthClient
  createLocalAuthStore

Browser extension
  createExtensionAuthClient
  createChromeAuthStore

Tauri
  createTauriAuthClient
  createTauriAuthStore
```

And the internal flow should be much flatter than today:

```text
signIn / signUp / signInWithGoogle
  -> call client method
  -> write store
  -> activate workspace if needed
  -> clear error / update status

signOut
  -> call client.signOut
  -> clear store
  -> deactivate workspace if needed

checkSession
  -> await store.ready
  -> restore cached user key if workspace variant
  -> call client.getSession
  -> on valid session: write store + activate workspace if needed
  -> on auth rejection: clear store + deactivate workspace
  -> on network/server failure: keep cached state
```

## File-Level Plan

### Primary file to refactor

- `packages/svelte-utils/src/auth-state.svelte.ts`

### App call sites to migrate

- `apps/zhongwen/src/lib/auth.ts`
- `apps/honeycrisp/src/lib/auth/index.ts`
- `apps/opensidian/src/lib/auth/index.ts`
- `apps/tab-manager/src/lib/state/auth.svelte.ts`

### Reference files to preserve behavior

- `apps/tab-manager/src/lib/state/storage-state.svelte.ts`
- `apps/tab-manager/src/lib/workspace/client.svelte.ts`
- `packages/workspace/src/workspace/create-workspace.ts`
- `packages/workspace/src/workspace/types.ts`

## Implementation Plan

### Phase 1: Rename and flatten the internal model

- [x] **1.1** Replace `AuthSession = { session, encryptionKey }` with a flat `AuthResult` shape.
- [x] **1.2** Replace `authApi` naming in internal types/helpers with `client` or `authClient`.
- [x] **1.3** Remove `createAuthController` and inline its behavior into the real constructors, extracting only small helper functions where necessary.
  > **Note**: The implementation keeps only narrow Better Auth adaptation helpers. The public constructors now own their own session and workspace lifecycle instead of delegating to another generic controller.
- [x] **1.4** Keep or improve the current JSDoc while flattening the architecture. Public constructors should explain when to use them, not just what they return.

### Phase 2: Reshape the public constructors

- [x] **2.1** Change the top-level public API to `createAuth({ client, store })`.
- [x] **2.2** Change the workspace-aware public API to `createWorkspaceAuth({ client, store, workspace, restoreUserKey? })`.
- [x] **2.3** Keep the domain split at the top level; do not add platform-specific top-level constructors.
- [x] **2.4** Ensure the public JSDoc explains the domain split clearly.

### Phase 3: Add platform helpers

- [x] **3.1** Add or rename client helpers to concrete platform names like `createWebAuthClient`, `createExtensionAuthClient`, and, if justified, `createTauriAuthClient`.
  > **Note**: Only the web and extension helpers were added. Tauri helpers were left out because no current call site needs them yet.
- [x] **3.2** Add or rename store helpers to concrete platform names like `createLocalAuthStore`, `createChromeAuthStore`, and, if justified, `createTauriAuthStore`.
  > **Note**: Only local and Chrome storage helpers were added for the same reason.
- [x] **3.3** Keep the extension on the same top-level `createWorkspaceAuth()` path by swapping implementations, not by introducing a separate platform-level constructor.
- [x] **3.4** Keep `restoreUserKey` as an optional workspace-only seam for platforms that can restore decrypt state before server validation.

### Phase 4: Migrate apps

- [x] **4.1** Migrate Zhongwen to `createAuth`.
- [x] **4.2** Migrate Honeycrisp and Opensidian to `createWorkspaceAuth`.
- [x] **4.3** Migrate tab-manager to `createWorkspaceAuth` with extension-specific client/store helpers.
- [x] **4.4** Delete or rename obsolete exports so the old architecture-first names do not remain as parallel APIs.

### Phase 5: Verification and cleanup

- [x] **5.1** Run formatting on touched files.
- [x] **5.2** Run the narrowest useful type-check available and note any unrelated repo blockers.
- [x] **5.3** Update this spec with review notes describing any deviations.

## Edge Cases

### Web Google redirect

1. A SPA calls `signInWithGoogle()`.
2. Better Auth starts a redirect and the page leaves.
3. This must not be treated as an auth failure; the auth state should simply survive until `checkSession()` rehydrates on the next load.

### Extension popup-based Google auth

1. The extension opens a popup via `browser.identity.launchWebAuthFlow`.
2. The popup returns an `id_token`.
3. The injected client must exchange that token through Better Auth and return a normal `AuthResult`.

### Auth rejection while workspace is cached

1. The app has persisted auth state and, for the extension, a cached user key.
2. `checkSession()` gets a 4xx auth rejection.
3. The store must clear and the workspace must deactivate encryption so local decrypted state is wiped.

### Offline or 5xx session check

1. The app has cached auth state.
2. `getSession()` fails because the server is unreachable.
3. Cached auth state should remain, and workspace auth should preserve whatever decrypt state was successfully restored before the roundtrip.

## Open Questions

1. **How many platform helpers should we add up front?**
   - Options: (a) only web + extension helpers now, (b) add Tauri helper names now as placeholders, (c) keep only generic helper names until Tauri is real
   - **Recommendation**: add only the helpers justified by current code, but structure the API so Tauri can slot in later without changing the top-level constructors.

2. **Should `createLocalAuthStore` and platform-specific store helpers remain exported?**
   - Options: (a) export both, (b) export only the cell adapter, (c) hide both behind the higher-level constructors
   - **Recommendation**: export the helpers that correspond to real platform seams; avoid exporting generic wrappers that just restate the same abstraction.

3. **Should Tauri get a restore hook immediately?**
   - **Recommendation**: no. Keep `restoreUserKey` optional and only use it if a concrete Tauri auth/storage flow requires it.

## Success Criteria

- [x] All auth call sites use the same top-level constructors: `createAuth` or `createWorkspaceAuth`.
- [x] Platform differences are expressed through injected client/store helpers instead of platform-specific top-level constructors.
- [x] The extension remains fully supported through extension-specific client/store implementations.
- [x] `createAuthController` no longer exists.
- [x] `AuthResult` is flat; there is no `session.session.user` nesting.
- [x] Public naming reflects product usage instead of implementation layers.
- [x] Public JSDoc explains when to use `createAuth` vs `createWorkspaceAuth`, and what the client/store seams represent.
- [x] Formatting and the narrowest useful verification pass complete, with unrelated repo blockers documented if present.

## References

- `packages/svelte-utils/src/auth-state.svelte.ts`
- `apps/zhongwen/src/lib/auth.ts`
- `apps/honeycrisp/src/lib/auth/index.ts`
- `apps/opensidian/src/lib/auth/index.ts`
- `apps/tab-manager/src/lib/state/auth.svelte.ts`
- `apps/tab-manager/src/lib/state/storage-state.svelte.ts`
- `apps/tab-manager/src/lib/workspace/client.svelte.ts`
- `packages/workspace/src/workspace/create-workspace.ts`
- `packages/workspace/src/workspace/types.ts`

## Review

**Completed**: 2026-03-25
**Branch**: `feat/sync-auto-reconnect`

### Summary

The shared auth module now exposes only the domain-level constructors `createAuth()` and `createWorkspaceAuth()`. Platform differences moved into injected `client` and `store` seams, with concrete helpers for web (`createWebAuthClient`, `createLocalAuthStore`) and the extension (`createExtensionAuthClient`, `createChromeAuthStore`).

The old architecture-first exports were removed instead of being kept as parallel aliases. `createAuthController` is gone, the flat `AuthResult` shape remains the only auth result shape, and the workspace-aware constructor still owns destructive sign-out through `workspace.deactivateEncryption()`.

### Deviations from Spec

- Tauri-specific helper names were not added. The current codebase only justified web and extension helpers, and adding placeholder Tauri exports now would have expanded the public API without a real consumer.

### Verification Notes

- `bun x biome check --write --linter-enabled=false packages/svelte-utils/src/auth-state.svelte.ts apps/zhongwen/src/lib/auth.ts apps/honeycrisp/src/lib/auth/index.ts apps/opensidian/src/lib/auth/index.ts apps/tab-manager/src/lib/state/auth.svelte.ts`
- `bun x biome check --write --linter-enabled=false specs/20260325T230903-auth-surface-simplification.md` (ignored by current Biome config; no files processed)
- `bun run --filter @epicenter/svelte typecheck`
- `bun run --filter @epicenter/zhongwen typecheck`
- `bun run --filter @epicenter/honeycrisp typecheck`
- `bun run --filter @epicenter/tab-manager typecheck`
- `bun run --filter opensidian check`

Those type-check runs all fail for unrelated pre-existing issues outside this auth refactor. The recurring blockers were:

- `packages/workspace/src/workspace/define-table.ts`: missing `NumberKeysOf`
- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`: generic `Ok(undefined)` and `null` typing failures
- `packages/ui/src/**`: widespread unresolved `#/...` import aliases and related typing fallout
- `packages/sync-client/src/provider.ts`: `string | null` passed where `string | undefined` is expected
- existing app-local errors in Honeycrisp, Opensidian, and tab-manager unrelated to auth surface changes

No verification failure pointed at the touched auth module or the migrated auth call sites.
