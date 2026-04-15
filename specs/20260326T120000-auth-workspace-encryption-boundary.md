# Auth Workspace Encryption Boundary

**Date**: 2026-03-26
**Status**: Draft
**Author**: Codex
**Branch**: `feat/sync-auto-reconnect`

## Overview

Finish the auth/workspace boundary by making startup restore a first-class local bootstrap contract, then let apps gate their workspace subtree on that derived contract instead of raw `workspace.whenReady`. The end state is simple: workspace owns cached-key lifecycle, auth owns auth policy, and the app layout waits for an app-level bootstrap promise that actually means "safe to render."

## Motivation

### Current State

The cached-key ownership cleanup is partly done already. `createWorkspaceAuth()` no longer takes `restoreUserKey`; it expects a workspace handle that already knows how to restore encryption:

```typescript
type WorkspaceHandle = {
	activateEncryption: (userKey: Uint8Array) => Promise<void>;
	restoreEncryption: () => Promise<boolean>;
	deactivateEncryption: () => Promise<void>;
};
```

And `checkSession()` already restores from cache before doing the network session check:

```typescript
async checkSession() {
	await store.ready;
	pendingAction = 'checking';

	const snapshot = store.read();
	await restoreCachedWorkspace(snapshot);

	const result = await client.getSession(snapshot.token);
	// ...
}
```

But the UI boundary is still muddy.

Whispering has no render gate around workspace hydration. The app layout renders immediately:

```svelte
<Sidebar.Provider bind:open={sidebarOpen}>
	{#if settings.get('ui.layoutMode') === 'sidebar'}
		<VerticalNav />
	{/if}
	<Sidebar.Inset> <AppLayout> {@render children()} </AppLayout> </Sidebar.Inset>
</Sidebar.Provider>
```

The one place that explicitly waits for workspace readiness is a migration:

```typescript
const { error: readyError } = await tryAsync({
	try: () => workspace.whenReady,
	// ...
});
```

And the `/debug` page demonstrates the failure mode clearly. It snapshots once:

```typescript
function createMetrics() {
	function snapshot() {
		return {
			ydocSize: Y.encodeStateAsUpdate(workspace.ydoc).byteLength,
			tables: tableDefs.map((t) => ({ label: t.label, count: t.count() })),
		};
	}

	let current = $state(snapshot());
	return { current, refresh() { current = snapshot(); } };
}
```

That page is wrong after reload because it never reacts when IndexedDB hydration finishes.

At the same time, other parts of the repo already use scoped render gates where they make sense. Tab Manager gates its main subtree on `browserState.whenReady`:

```svelte
{#await browserState.whenReady}
	<div class="flex-1 flex items-center justify-center">
		<Spinner />
	</div>
{:then}
	<!-- app content -->
{/await}
```

This creates problems:

1. **`workspace.whenReady` is too low-level for UI code**: it only means the persistence extension finished hydrating. It does not mean auth restore, migrations, or decryption state are settled.
2. **Startup restore is coupled to `checkSession()`**: today the only guaranteed startup restore path is inside a method that also performs a network request.
3. **Apps have no single "safe to render" contract**: each page either guesses, tolerates empty initial state, or accidentally snapshots too early.
4. **A global gate on raw `workspace.whenReady` would hide, not solve, boundary confusion**: it papers over pages like `/debug`, but it still gives the UI the wrong primitive.
5. **The constructor cleanup is not enough by itself**: "workspace owns restore" is only half the job; the app still needs a stable bootstrap boundary.

### Desired State

The final ownership split should look like this:

```text
WORKSPACE
├── activateEncryption(userKey)
├── restoreEncryption()
└── deactivateEncryption()

AUTH
├── restore local auth snapshot
├── coordinate workspace restore/deactivate
├── perform sign-in / sign-out / session validation
└── expose local bootstrap readiness

APP
├── compose app-specific bootstrap tasks
└── gate the workspace subtree on appReady
```

And the UI should wait on a derived app contract, not on raw workspace internals:

```svelte
{#await appReady}
	<BootstrapSplash />
{:then}
	{@render children()}
{/await}
```

For workspace-auth apps, that `appReady` should mean:

1. persisted auth snapshot is readable
2. cached workspace decryption has been attempted
3. app-specific post-hydration tasks are done

It should not mean:

1. the server session roundtrip has completed
2. background auth refresh has succeeded
3. every page can ignore live reactivity forever

## Research Findings

### The auth boundary is cleaner than the current spec claimed

`createWorkspaceAuth()` already uses a workspace-owned `restoreEncryption()` method. The old `restoreUserKey` callback is gone from the current constructor shape.

**Key finding**: the cached-key ownership move is already underway in code.

**Implication**: the remaining design work is not "move restore out of auth" from scratch. It is "finish the bootstrap contract so the UI can depend on something better than `checkSession()` timing."

### Startup restore is currently hidden inside a network-y method

The startup restore path lives inside `checkSession()`, before `client.getSession(...)`.

**Key finding**: local bootstrap and remote session validation are bundled together.

**Implication**: apps cannot wait for "local state is ready" without also piggybacking on a network request, unless they reach around auth and call lower-level workspace methods directly. That is the wrong seam.

### `workspace.whenReady` is necessary, but not sufficient

Whispering migrations correctly await `workspace.whenReady`, because they need hydrated KV values before doing first-write-wins checks.

But `workspace.whenReady` only covers persistence hydration. It says nothing about auth snapshot readiness, cached decrypt restore, or app-specific migrations.

**Key finding**: `workspace.whenReady` is a substrate primitive, not a UI contract.

**Implication**: layouts should not gate directly on it unless the app genuinely has no higher-level bootstrap concerns.

### The repo already accepts scoped render gates

Tab Manager already gates UI on `browserState.whenReady`.

**Key finding**: the codebase is not opposed to `#await` boundaries. The question is what they await.

**Implication**: a subtree gate on `appReady` is consistent with existing patterns. The smell is not the `#await`; the smell is awaiting the wrong thing.

### Pages still need to be hydration-tolerant

The reactive state modules already document and handle "initially empty, then populated later" behavior. The `/debug` page does not; it snapshots once and never resubscribes.

**Key finding**: a good bootstrap boundary reduces bad first paint, but it does not remove the need for correct reactive pages.

**Implication**: we should both add a better app boundary and fix obviously non-reactive pages like `/debug`.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Cached-key lifecycle owner | Workspace encryption boundary | Save, restore, and clear are one concern and should have one owner |
| Auth startup contract | Add a local bootstrap promise/state to `createWorkspaceAuth` | Apps need a network-independent readiness contract for first render |
| Session validation | Keep `checkSession()` for network validation | It is still useful, but it should not be the only startup restore path |
| UI gate primitive | Gate on derived `appReady`, not raw `workspace.whenReady` | `appReady` can include migrations and future auth/encryption work without leaking internals |
| Gate scope | Workspace/auth subtree only | Root shell can render immediately; only the dependent subtree needs gating |
| Page correctness | Keep pages hydration-tolerant and reactive | The gate improves first paint; it is not a substitute for reactivity |
| `/debug` fix | Fix locally as a page bug | A global gate should not be introduced just to hide one stale snapshot page |

## Architecture

### Current

What the current startup boundary really looks like:

```text
root layout
└── renders immediately
    └── app subtree renders immediately
        ├── some state modules tolerate empty → hydrated
        ├── some pages snapshot too early
        └── authState.checkSession() is kicked off on mount
            ├── await store.ready
            ├── attempt workspace.restoreEncryption()
            └── perform getSession() network request
```

Ownership today:

```text
WORKSPACE
├── persistence hydration
├── cached decrypt restore primitive
├── activation
└── teardown

AUTH
├── local auth snapshot persistence
├── startup restore trigger
└── network session validation

APP
└── no single bootstrap contract
```

### Proposed

Introduce a clean two-level boundary:

```text
root layout
└── renders immediately
    └── (app) layout
        └── awaits appReady
            ├── authState.whenReady
            └── app-specific bootstrap tasks
                └── children render
```

And split auth startup into two phases:

```text
PHASE 1: Local bootstrap
────────────────────────
authState.whenReady
├── await store.ready
├── inspect cached session snapshot
├── if signed in, attempt workspace.restoreEncryption()
└── resolve once local decrypted state is settled

PHASE 2: Remote validation
──────────────────────────
authState.checkSession()
├── may await authState.whenReady internally
├── call client.getSession(token)
├── update user/token if valid
└── deactivate workspace + clear state on explicit auth rejection
```

The app then composes its own readiness:

```text
APP READY
├── authState.whenReady
├── workspace.whenReady only if needed directly by app-local tasks
└── post-hydration work such as migrateOldSettings()
```

## Flow

STEP 1: Construction
────────────────────
The app constructs `workspace` and `authState`. Workspace already knows how to save, restore, and clear cached keys.

STEP 2: Local bootstrap
───────────────────────
`authState.whenReady` resolves after auth storage is readable and cached workspace restore has been attempted. No server roundtrip is required for this phase.

STEP 3: App bootstrap
─────────────────────
The app composes `appReady = Promise.all([...])` from `authState.whenReady` plus any app-specific tasks such as settings migration, then gates the workspace subtree on that promise.

STEP 4: Background session validation
─────────────────────────────────────
The app triggers `authState.checkSession()` after local bootstrap begins or completes. This validates the server session and updates or clears local state, but it is not the thing the first render waits on.

STEP 5: Live runtime
────────────────────
Pages continue to react to workspace updates normally. Hydration-tolerant modules still handle later changes; the bootstrap gate only prevents obviously wrong first paint.

## Proposed API

### Workspace encryption

Keep the current direction where workspace owns cached-key lifecycle:

```typescript
type EncryptionConfig = {
	keyCache?: KeyCache;
	onActivate?: (userKey: Uint8Array) => MaybePromise<void>;
	onDeactivate?: () => MaybePromise<void>;
};

type EncryptionMethods = {
	readonly isEncrypted: boolean;
	activateEncryption(userKey: Uint8Array): Promise<void>;
	restoreEncryption(): Promise<boolean>;
	deactivateEncryption(): Promise<void>;
};
```

`restoreEncryption()` remains a workspace concern. Auth should not know where keys are cached or how they are encoded.

### Auth bootstrap

Add a local bootstrap contract to workspace-aware auth:

```typescript
type WorkspaceAuthState = {
	readonly status: AuthStatus;
	readonly whenReady: Promise<void>;
	checkSession(): Promise<StoredUser | null>;
	signIn(credentials: EmailSignInCredentials): Promise<void>;
	signUp(credentials: EmailSignUpCredentials): Promise<void>;
	signInWithGoogle(): Promise<void>;
	signOut(): Promise<void>;
};
```

`whenReady` should:

1. await `store.ready`
2. read the persisted auth snapshot
3. if a signed-in snapshot exists, attempt `workspace.restoreEncryption()`
4. resolve when local bootstrap is complete

`whenReady` should not:

1. require `client.getSession(...)`
2. block on the network
3. imply that all future async work is done

`checkSession()` should:

1. await `whenReady` internally or otherwise be safe to call before it resolves
2. perform server validation
3. update the local auth snapshot on success
4. call `workspace.deactivateEncryption()` on explicit auth rejection

### App bootstrap

Do not add a framework-wide bootstrap abstraction in `packages/`. Keep this app-local:

```typescript
const appReady = Promise.all([
	authState.whenReady,
	migrateOldSettings(),
]).then(() => {});
```

Apps without workspace-aware auth can still compose their own boundary:

```typescript
const appReady = Promise.all([
	workspace.whenReady,
	migrateOldSettings(),
]).then(() => {});
```

The contract is the important part: the UI awaits `appReady`, not raw internal readiness from whichever dependency happened to exist first.

## Implementation Plan

### Phase 1: Finish the auth bootstrap contract

- [ ] **1.1** Add `whenReady: Promise<void>` to the `createWorkspaceAuth()` return shape.
- [ ] **1.2** Make local bootstrap run independently of `checkSession()` so cached restore does not depend on a networked method call.
- [ ] **1.3** Ensure `checkSession()` is safe to call before `whenReady` settles, either by awaiting it internally or by sharing the same bootstrap promise.
- [ ] **1.4** Keep docs explicit about the difference between local bootstrap readiness and remote session validation.

### Phase 2: Introduce app-level bootstrap boundaries

- [ ] **2.1** Add an app-local `appReady` promise in each workspace-backed app.
- [ ] **2.2** Gate the workspace/auth subtree on that derived promise, not on raw `workspace.whenReady`.
- [ ] **2.3** Keep the root shell ungated unless the whole app truly depends on the workspace subtree.
- [ ] **2.4** For Whispering, compose `appReady` from the minimal real dependencies for that app, including settings migration.

### Phase 3: Fix pages that rely on accidental startup timing

- [ ] **3.1** Update Whispering `/debug` so metrics react to hydration and later workspace changes.
- [ ] **3.2** Audit other pages for one-time snapshots of workspace-backed state.
- [ ] **3.3** Preserve the existing hydration-tolerant behavior in state modules; do not regress them by assuming the gate makes all later updates synchronous.

### Phase 4: Verification

- [ ] **4.1** Add or update tests for `createWorkspaceAuth().whenReady` local bootstrap behavior.
- [ ] **4.2** Verify cached startup restore works before the server session roundtrip completes.
- [ ] **4.3** Verify explicit auth rejection still tears down decrypted workspace state and cached keys.
- [ ] **4.4** Verify layout gating removes bad first paint without blocking on offline or slow network startup.
- [ ] **4.5** Run the narrowest useful type-check and record any unrelated repo blockers.

## Edge Cases

### Persisted user exists, network is offline

1. Auth storage restores a signed-in snapshot.
2. `authState.whenReady` attempts `workspace.restoreEncryption()` and resolves.
3. The app renders from local decrypted state.
4. `checkSession()` may fail later, but offline startup still works.

### Persisted user exists, session is invalid

1. Local bootstrap restores decrypted workspace state from cache.
2. `checkSession()` receives an explicit 4xx rejection.
3. Auth clears the local session and calls `workspace.deactivateEncryption()`.
4. Encrypted local data becomes unreadable again and cached keys are cleared.

### No key cache configured

1. Workspace is built with `.withEncryption({})`.
2. `authState.whenReady` attempts `workspace.restoreEncryption()`.
3. Restore returns `false` and bootstrap still resolves cleanly.

### Corrupt cached key

1. `workspace.restoreEncryption()` encounters invalid cached data.
2. Restore fails safely and returns `false` or equivalent failure behavior.
3. `whenReady` still resolves; the app stays signed-in or signed-out according to auth snapshot, but encrypted local state remains unreadable.

### Page snapshots once at startup

1. A page reads workspace state before hydration completes.
2. The page stores a derived snapshot in local component state and never resubscribes.
3. Even with a layout gate, later workspace changes can still make that page stale.
4. The page must be fixed locally; the gate is not enough.

## Open Questions

1. **Should `createWorkspaceAuth()` expose only `whenReady`, or also a reactive bootstrap status?**
   - Options: (a) `whenReady` only, (b) `whenReady` plus `bootstrapStatus`, (c) a richer state machine
   - **Recommendation**: start with `whenReady` only. It solves the layout contract with minimal API surface. Add reactive status later only if a real app needs richer boot UI.

2. **Should `checkSession()` still trigger cached restore defensively?**
   - Options: (a) no, local bootstrap owns restore exclusively, (b) yes, keep it idempotently, (c) split into `restoreSession()` and `validateSession()`
   - **Recommendation**: keep it idempotent for now. Let `whenReady` own first render readiness, but keep `checkSession()` safe when called in isolation.

3. **Should Whispering gate on auth bootstrap or only on workspace + migration readiness?**
   - Options: (a) workspace + migration only, (b) future auth bootstrap too, (c) no gate at all
   - **Recommendation**: workspace + migration only for now. Whispering is the concrete example of a workspace-backed app without the full auth dependency.

4. **Should the future constructor collapse still happen?**
   - Options: (a) collapse to `createAuth({ auth, workspace })`, (b) keep `createAuth` and `createWorkspaceAuth`, (c) decide per app
   - **Recommendation**: defer. The stronger immediate win is the bootstrap boundary; constructor collapse is a separate API-design decision.

## Success Criteria

- [ ] Workspace continues to own cached-key save, restore, and clear.
- [ ] `createWorkspaceAuth()` exposes a local bootstrap readiness contract independent of network session validation.
- [ ] Apps gate their workspace/auth subtree on derived `appReady`, not raw `workspace.whenReady`.
- [ ] Whispering `/debug` no longer depends on accidental hydration timing.
- [ ] Offline startup with a cached key can render usable local state before a server roundtrip finishes.
- [ ] Explicit auth rejection still tears down decrypted local state and clears cached keys.
- [ ] The spec clearly separates workspace readiness, auth bootstrap readiness, and app bootstrap readiness.

## References

- `packages/svelte-utils/src/auth-state.svelte.ts` - current workspace-aware auth state and startup restore path
- `packages/workspace/src/workspace/create-workspace.ts` - encryption lifecycle implementation
- `packages/workspace/src/workspace/types.ts` - `EncryptionConfig` and `EncryptionMethods`
- `packages/workspace/src/shared/crypto/key-cache.ts` - `KeyCache` interface
- `apps/tab-manager/src/lib/state/key-cache.ts` - Chrome extension key cache implementation
- `apps/tab-manager/src/entrypoints/sidepanel/App.svelte` - existing subtree `#await` pattern on app-local readiness
- `apps/whispering/src/routes/(app)/+layout.svelte` - current immediate render of workspace-dependent shell
- `apps/whispering/src/lib/migration/migrate-settings.ts` - app-local post-hydration task already awaiting workspace readiness
- `apps/whispering/src/routes/(app)/(config)/debug/+page.svelte` - concrete stale-snapshot page demonstrating the timing bug
- `specs/20260325T230903-auth-surface-simplification.md` - previous auth surface refactor
