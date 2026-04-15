# Opinionated Workspace Auth API

**Date**: 2026-03-26
**Status**: Implemented
**Author**: Codex
**Branch**: `feat/sync-auto-reconnect`

Supersedes the direction in these recent drafts:

- `specs/20260325T222454-workspace-auth-layering.md`
- `specs/20260326T080519-workspace-auth-isolation.md`
- `specs/20260326T120000-auth-workspace-encryption-boundary.md`

Execute this after:

- `specs/20260326T085906-sync-workspace-hkdf.md`

## Overview

Replace the current split auth surface in `@epicenter/svelte` with one main, opinionated controller for Epicenter apps: `createWorkspaceAuth(...)`. Keep `@epicenter/workspace` as the plain JavaScript data client with an encryption subsystem, but stop making the shared Svelte layer pretend that Better Auth and workspace-coupled encryption are optional first-class variations.

## Motivation

### Current State

The current shared package exports two auth constructors plus multiple helper seams:

```json
{
  "exports": {
    "./auth-state": "./src/auth-state.svelte.ts",
    "./workspace-auth": "./src/workspace-auth.svelte.ts"
  }
}
```

The generic auth module currently owns Better Auth transport abstraction, store abstraction, token persistence, and the main phase machine:

```typescript
export type AuthClient = {
  signIn(credentials: EmailSignInCredentials): Promise<AuthResult>;
  signUp(credentials: EmailSignUpCredentials): Promise<AuthResult>;
  signInWithGoogle(): Promise<AuthResult>;
  signOut(token: string | null): Promise<void>;
  getSession(token: string | null): Promise<AuthResult | null>;
};

export type AuthStore = {
  ready: Promise<void>;
  read(): SessionSnapshot;
  write(snapshot: SessionSnapshot): void | Promise<void>;
  clear(): void | Promise<void>;
  subscribe?(listener: (snapshot: SessionSnapshot) => void): (() => void) | undefined;
};
```

Workspace auth is a second public constructor layered on top:

```typescript
export function createWorkspaceAuth({
  client,
  store,
  encryption,
}: {
  client: AuthClient;
  store: AuthStore;
  encryption: WorkspaceEncryptionController;
}) {
  // ...
}
```

Current consumers are split like this:

```typescript
// Workspace apps
export const authState = createWorkspaceAuth({
  client: createWebAuthClient({ baseURL: APP_URLS.API }),
  store: createLocalAuthStore('honeycrisp'),
  encryption: workspace.encryption,
});

// Plain auth app
export const authState = createAuth({
  client: createWebAuthClient({ baseURL: APP_URLS.API }),
  store: createLocalAuthStore('zhongwen'),
});
```

The workspace side is already mostly honest: auth is not inside the workspace client, and encryption is namespaced under `workspace.encryption`:

```typescript
await workspace.encryption.activate(userKey);
await workspace.encryption.restoreEncryptionFromCache();
await workspace.encryption.deactivate();
```

This creates problems:

1. **The public API is optimized around variability we do not actually have**: three in-repo apps need workspace-coupled auth; one app is plain auth.
2. **Better Auth is effectively mandatory but still modeled as a fully injected transport boundary**: `AuthClient` is public abstraction weight without much real product payoff.
3. **The shared layer is not Svelte-first enough**: it exposes reactive getters, but not a first-class subscription contract or a clean local bootstrap split that app layouts can rely on directly.
4. **The current split overvalues the outlier**: `createAuth` and `createWorkspaceAuth` read like equally central product shapes, but they are not.
5. **The working tree is already mid-refactor in this exact area**: stacking a deeper API collapse on top of a mixed diff without a checkpoint will make the branch hard to review and hard to recover.

### Desired State

The shared package should admit the real default:

```typescript
import {
  createWorkspaceAuth,
  createLocalSessionStore,
} from '@epicenter/svelte/auth';

export const auth = createWorkspaceAuth({
  baseURL: APP_URLS.API,
  store: createLocalSessionStore('honeycrisp'),
  encryption: workspace.encryption,
});
```

Extension apps still get one narrow variation seam:

```typescript
export const auth = createWorkspaceAuth({
  baseURL: () => remoteServerUrl.current,
  store: createChromeSessionStore({ token: authToken, user: authUser }),
  encryption: workspace.encryption,
  signInWithGoogle: async (client) => {
    // extension-specific OAuth, then exchange with Better Auth
  },
});
```

And app startup becomes explicit instead of hiding everything in `start()`:

```typescript
const appReady = auth.bootstrap();
void auth.refreshSession();
```

`@epicenter/workspace` should stay auth-agnostic. It remains the data plane; the new Svelte auth controller remains the orchestration plane.

## Research Findings

### Real Consumer Shape in This Repo

Current usage:

| App | Uses shared auth | Needs workspace decryption tied to auth |
| --- | --- | --- |
| `apps/honeycrisp` | Yes | Yes |
| `apps/opensidian` | Yes | Yes |
| `apps/tab-manager` | Yes | Yes |
| `apps/zhongwen` | Yes | No |

**Key finding**: the dominant shape is not generic session auth. It is Better Auth plus workspace encryption.

**Implication**: the shared public API should optimize for workspace apps first and treat plain session auth as secondary.

### Better Auth Variability Is Narrow

Across the repo, the real variation is not in auth semantics. It is in how Google sign-in starts.

| Context | Variation | Common behavior |
| --- | --- | --- |
| Web app | Better Auth redirect flow | sign-in, session fetch, bearer token capture, sign-out |
| Chrome extension | `chrome.identity` flow, then Better Auth exchange | sign-in, session fetch, bearer token capture, sign-out |

**Key finding**: the variation is one strategy override, not a full transport family.

**Implication**: keep one narrow `signInWithGoogle` override seam; internalize the rest of the Better Auth client setup.

### Workspace Is Already the Right Low-Level Boundary

The current workspace package already has the right responsibility split:

- `workspace.encryption.activate(userKey)`
- `workspace.encryption.restoreEncryptionFromCache()`
- `workspace.encryption.deactivate()`

It also already owns cached user-key save/load/clear through `UserKeyCache`.

**Key finding**: the workspace package is already acting like a clean JavaScript subsystem, not an app controller.

**Implication**: do not move auth into the workspace package. That would turn the data client into an application god-object.

### Session Storage Still Earns a Public Seam

There is still a real difference between web and extension persistence:

| Store type | Readiness | Persistence medium | External sync |
| --- | --- | --- |
| Local session store | synchronous | localStorage-backed state | usually local only |
| Chrome session store | async readiness | chrome storage wrappers | cross-context updates matter |

**Key finding**: store differences are real enough to keep a store seam public.

**Implication**: keep a public `SessionStore` boundary and store factory helpers. Collapse the auth transport seam, not the persistence seam.

### Comparison of the Three Honest Options

| Option | Boundary clarity | Shared reuse | Complexity | Recommendation |
| --- | --- | --- | --- | --- |
| Move auth into `@epicenter/workspace` | bad | high | high | reject |
| One opinionated Svelte auth controller over workspace | best | high | medium | recommend |
| Inline auth separately in each app | good | low | medium | fallback if shared API still feels too configurable |

**Key finding**: the cleanest shape is one opinionated Svelte controller over a plain JS workspace client.

**Implication**: the correct collapse happens in `@epicenter/svelte`, not in `@epicenter/workspace`.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Main shared auth API | `createWorkspaceAuth(...)` | Matches the dominant product shape |
| Generic auth public weight | Demote heavily | One in-repo outlier should not shape the main architecture |
| Better Auth setup | Internalize into `createWorkspaceAuth` | Removes public DI that does not earn its complexity |
| Google auth variation | Keep one narrow `signInWithGoogle(client)` override | Covers extension OAuth without preserving a full injected client layer |
| Persistence seam | Keep `SessionStore` public | Web and extension storage differences are real |
| Workspace boundary | Keep auth out of `@epicenter/workspace` | Preserves a clean JS data client |
| Encryption ownership | Keep under `workspace.encryption` | Encryption is a workspace subsystem, not app auth policy |
| Startup API | Split `bootstrap()` from `refreshSession()` | Local readiness and remote validation are different phases |
| Reactive contract | Add `subscribe(listener)` to the controller | Makes non-component orchestration honest and direct |
| Public module path | Add `@epicenter/svelte/auth` | Reflects the new main entry point cleanly |
| Backward compatibility | Use short-lived re-export shims during migration only | Keep waves buildable without preserving old architecture long-term |
| Commit strategy | Checkpoint current boundary cleanup before deeper collapse | Prevents the branch from turning into one giant mixed diff |

## Architecture

### Package Boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│ @epicenter/workspace                                        │
│ plain JS data client                                        │
│                                                             │
│ createWorkspace(...)                                        │
│ workspace.tables / workspace.kv                             │
│ workspace.whenReady                                         │
│ workspace.encryption.activate(userKey)                      │
│ workspace.encryption.restoreEncryptionFromCache()           │
│ workspace.encryption.deactivate()                           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ orchestrated by
                              │
┌─────────────────────────────────────────────────────────────┐
│ @epicenter/svelte/auth                                      │
│ createWorkspaceAuth(...)                                    │
│                                                             │
│ Better Auth client setup                                    │
│ session persistence policy                                  │
│ local bootstrap                                             │
│ remote session refresh                                      │
│ sign-in / sign-up / sign-out                                │
│ auth-aware fetch                                            │
│ reactive getters + subscribe(listener)                      │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ composed by
                              │
┌─────────────────────────────────────────────────────────────┐
│ app                                                          │
│                                                             │
│ const appReady = auth.bootstrap()                           │
│ void auth.refreshSession()                                  │
│ root layout gates subtree on appReady                       │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Public API

```typescript
type SessionSnapshot = {
  token: string | null;
  user: StoredUser | null;
};

type SessionStore = {
  ready: Promise<void>;
  read(): SessionSnapshot;
  write(snapshot: SessionSnapshot): void | Promise<void>;
  clear(): void | Promise<void>;
  subscribe?(
    listener: (snapshot: SessionSnapshot) => void,
  ): (() => void) | undefined;
};

type WorkspaceAuthStatus =
  | 'bootstrapping'
  | 'checking'
  | 'signing-in'
  | 'signing-out'
  | 'signed-in'
  | 'signed-out';

type WorkspaceAuthState = {
  status: WorkspaceAuthStatus;
  user: StoredUser | null;
  token: string | null;
  signInError?: string;
};

type WorkspaceAuth = {
  readonly state: WorkspaceAuthState;
  readonly status: WorkspaceAuthStatus;
  readonly user: StoredUser | null;
  readonly token: string | null;
  readonly signInError?: string;

  subscribe(listener: (state: WorkspaceAuthState) => void): () => void;

  bootstrap(): Promise<StoredUser | null>;
  refreshSession(): Promise<StoredUser | null>;

  signIn(credentials: { email: string; password: string }): Promise<void>;
  signUp(credentials: {
    email: string;
    password: string;
    name: string;
  }): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;

  fetch: typeof fetch;
};

export function createWorkspaceAuth({
  baseURL,
  store,
  encryption,
  signInWithGoogle,
}: {
  baseURL: string | (() => string);
  store: SessionStore;
  encryption: WorkspaceEncryptionController;
  signInWithGoogle?: (
    client: ReturnType<typeof createAuthClient>,
  ) => Promise<{ user: User; encryptionKey?: string | null }>;
}): WorkspaceAuth;
```

### Lifecycle Flow

```text
BOOTSTRAP
─────────
1. await store.ready
2. read local session snapshot
3. if snapshot.user exists:
   └── await encryption.restoreEncryptionFromCache()
4. resolve bootstrap promise
5. do not require network

REFRESH SESSION
───────────────
1. call Better Auth getSession(snapshot.token)
2. if 4xx / invalid session:
   ├── await encryption.deactivate()
   └── await store.clear()
3. if valid session:
   ├── require userKeyBase64
   ├── await encryption.activate(base64ToBytes(userKeyBase64))
   └── await store.write(...)
4. if network failure:
   └── keep cached local state

SIGN IN / SIGN UP
─────────────────
1. call Better Auth sign-in method
2. require userKeyBase64
3. await encryption.activate(base64ToBytes(userKeyBase64))
4. await store.write(...)

SIGN OUT
────────
1. attempt Better Auth signOut()
2. await encryption.deactivate()
3. await store.clear()
```

### What This Explicitly Does Not Do

```text
createWorkspaceAuth does NOT:
├── create the workspace client
├── own IndexedDB or Yjs hydration
├── decide app-specific migrations
└── move Better Auth into @epicenter/workspace

workspace does NOT:
├── know about Better Auth
├── know about Svelte component lifecycles
├── expose sign-in or sign-out policy
└── become the app controller
```

## Commit Strategy

This branch is already dirty in auth/workspace files and in unrelated app/spec files. Do not make one giant checkpoint commit from the current full working tree.

Recommended preflight:

1. Separate auth/workspace boundary work from unrelated UI/spec/worktree noise.
2. If the current auth/workspace changes are the intended baseline, checkpoint them first.
3. Only after that checkpoint should the deeper API collapse begin.

Recommended waves:

```text
Wave 0: Checkpoint current boundary cleanup
Wave 1: Add new opinionated auth module and store names
Wave 2: Migrate workspace apps to the new controller
Wave 3: Resolve Zhongwen strategy
Wave 4: Remove old exports, shims, and dead types
```

Recommended commit messages:

```text
refactor(auth): checkpoint workspace encryption boundary cleanup
refactor(auth): add opinionated workspace auth module
refactor(auth): migrate workspace apps to unified auth controller
refactor(auth): remove legacy auth-state and workspace-auth surfaces
```

If the current diff is not ready for a checkpoint, shelve unrelated work first. The important rule is simple: do not start the API collapse on top of a mixed, unreviewable diff.

## Implementation Plan

### Phase 0: Preflight

- [x] **0.1** Audit the current dirty worktree and isolate auth/workspace files from unrelated changes.
- [x] **0.2** Execute `specs/20260326T085906-sync-workspace-hkdf.md` first so the workspace encryption lifecycle is simplified before the auth API collapse begins.
  > Execution treated the HKDF refactor as an already-completed baseline, per the handoff.
- [x] **0.3** Create a checkpoint commit for the current boundary-cleanup state, or shelve that state if it is not yet coherent.
  > The checkpoint existed before this pass started; this spec execution layered the API collapse on top of that baseline instead of replaying it.
- [x] **0.4** Create or move to a feature branch dedicated to the opinionated auth API if the current branch remains too mixed.
  > Kept the work on `feat/sync-auto-reconnect` because the HKDF baseline already lived there. The safety measure was scoped staging and scoped commits, not another branch split.

### Phase 1: Introduce the new main shared module

- [x] **1.1** Add `packages/svelte-utils/src/auth.svelte.ts` as the new main module.
- [x] **1.2** Move the phase machine, Better Auth setup, auth-aware fetch, and workspace encryption orchestration into `createWorkspaceAuth(...)`.
- [x] **1.3** Rename public storage types from `AuthStore` to `SessionStore`.
- [x] **1.4** Export `createLocalSessionStore(...)` and `createChromeSessionStore(...)`.
- [x] **1.5** Add `subscribe(listener)` and the new `bootstrap()` split to the controller.

### Phase 2: Keep the branch buildable during migration

- [x] **2.1** Add temporary re-exports from `./auth-state` and `./workspace-auth` to the new module.
  > Deliberately skipped the shims and migrated all in-repo consumers in the same pass. That kept the branch buildable without preserving the old surface.
- [x] **2.2** Keep old names working only long enough to migrate in-repo consumers.
  > The old names never shipped as compatibility shims; they were removed once the in-repo migrations were done.
- [ ] **2.3** Add or update type tests around `bootstrap()`, `refreshSession()`, and workspace sign-out teardown behavior.

### Phase 3: Migrate workspace app consumers

- [x] **3.1** Migrate Honeycrisp to `@epicenter/svelte/auth`.
- [x] **3.2** Migrate Opensidian to `@epicenter/svelte/auth`.
- [x] **3.3** Migrate Tab Manager to `@epicenter/svelte/auth`, preserving the extension Google override and chrome store behavior.
- [x] **3.4** Update app startup code to use `const appReady = auth.bootstrap(); void auth.refreshSession();`.

### Phase 4: Resolve the plain-auth outlier

- [x] **4.1** Decide whether Zhongwen should inline its small auth flow locally or use a tiny secondary helper.
- [x] **4.2** If a secondary helper is kept, make it visibly secondary and keep it out of the main docs path.
  > No secondary helper was kept. Zhongwen now owns its small local auth controller.
- [x] **4.3** Do not let Zhongwen force the main shared API back into a generic architecture.

### Phase 5: Remove the old public surface

- [x] **5.1** Remove `AuthClient`, `createWebAuthClient`, and `createExtensionAuthClient` from the public shared API.
- [x] **5.2** Remove long-lived compatibility shims from `./auth-state` and `./workspace-auth`.
- [x] **5.3** Update `packages/svelte-utils/package.json` exports to prefer `./auth`.
- [x] **5.4** Update docs and examples so the new controller is the canonical path.

## Edge Cases

### Cached local session exists, but cached user key is gone

1. Local session snapshot contains `user`.
2. `bootstrap()` runs and `restoreEncryptionFromCache()` returns false.
3. UI still gets a completed local bootstrap, but encrypted workspace data is not yet unlocked.
4. `refreshSession()` should attempt to fetch a fresh session and re-activate encryption if the session is still valid.

### Server is offline during startup

1. `bootstrap()` completes from local state only.
2. `refreshSession()` fails due to network.
3. Cached session remains; workspace stays in whatever decrypted state bootstrap established.
4. The app remains usable offline.

### External extension context signs out

1. Another browser context clears the session store.
2. `store.subscribe()` fires externally.
3. The controller must deactivate encryption and clear local derived state without double-running local write orchestration.

### Sign-in succeeds but the session is missing `userKeyBase64`

1. Better Auth sign-in returns a user.
2. The custom session field is missing.
3. The controller must treat this as an auth failure for workspace apps and avoid persisting a misleading signed-in state.

## Open Questions

1. **What should we do with Zhongwen?**
   - Options: (a) inline a small local auth module in `apps/zhongwen`, (b) keep a tiny `createSessionAuth(...)` helper in `@epicenter/svelte`, (c) force Zhongwen onto workspace auth semantics later.
   - **Recommendation**: choose (a) unless a second non-workspace app appears soon. One outlier should not keep the main public API generic.

2. **Should the Google override callback receive the internal Better Auth client directly?**
   - Options: (a) yes, pass the client to `signInWithGoogle(client)`, (b) expose a smaller wrapper API instead, (c) split web and extension constructors again.
   - **Recommendation**: choose (a). It is the smallest seam that still covers the extension flow without resurrecting a full transport abstraction.

3. **Should we keep `start()` as sugar for `bootstrap() + refreshSession()`?**
   - Options: (a) keep it, (b) remove it entirely, (c) keep it internally but do not document it.
   - **Recommendation**: choose (b). The split is the whole point; keeping `start()` would invite the old conceptual blur back in.

4. **Should `subscribe(listener)` live on the controller even though Svelte components can read getters reactively?**
   - Options: (a) yes, add it for app infrastructure and non-component consumers, (b) no, force consumers to use Svelte effects only.
   - **Recommendation**: choose (a). It makes cross-cutting orchestration honest and removes the need for awkward effect-only observation patterns.

## Review

**Completed**: 2026-03-26
**Branch**: `feat/sync-auto-reconnect`

### Summary

`@epicenter/svelte` now has one main auth entry point: `@epicenter/svelte/auth`. That module exposes `createWorkspaceAuth(...)`, the session-store seam, and the stored-user schema while internalizing Better Auth client construction and the normal web Google flow.

Honeycrisp, Opensidian, and Tab Manager now all use the same opinionated controller and the same startup split: `const appReady = auth.bootstrap(); void auth.refreshSession();`. Zhongwen no longer keeps generic auth alive in the shared package; it owns a small local auth module instead.

### Deviations From Spec

- The migration skipped temporary `./auth-state` and `./workspace-auth` re-export shims. All in-repo consumers moved in the same pass, then the old surface was deleted.
- No dedicated auth type tests were added. Verification relied on focused package/app typecheck attempts, but the branch still has broad pre-existing failures in `packages/workspace`, `packages/ui`, and some app-local modules that are outside this auth change.

### Follow-up Work

- Add focused tests around `bootstrap()`, `refreshSession()`, and extension cross-context sign-out once the branch has a stable auth test harness.
- Clean up the unrelated typecheck failures that currently mask targeted verification, especially the existing `packages/workspace` and `packages/ui` errors.

## Success Criteria

- [ ] Workspace apps use one main shared controller with a small, honest constructor surface.
- [ ] Better Auth transport abstraction is no longer a public first-class API in `@epicenter/svelte`.
- [ ] `@epicenter/workspace` remains auth-agnostic and continues to expose encryption only as a workspace subsystem.
- [ ] App startup can await `auth.bootstrap()` independently of `auth.refreshSession()`.
- [ ] The controller exposes a clean reactive contract for Svelte reads and non-component subscriptions.
- [ ] The branch history tells a clear story through checkpoint and migration waves instead of one large mixed commit.

## References

- `packages/svelte-utils/package.json` - current shared package exports
- `packages/svelte-utils/src/auth-state.svelte.ts` - current generic auth layer
- `packages/svelte-utils/src/workspace-auth.svelte.ts` - current workspace auth wrapper
- `packages/workspace/src/workspace/create-workspace.ts` - workspace encryption controller implementation
- `packages/workspace/src/workspace/user-key-cache.ts` - user-key cache boundary
- `apps/honeycrisp/src/lib/auth/index.ts` - current workspace auth consumer
- `apps/opensidian/src/lib/auth/index.ts` - current workspace auth consumer
- `apps/tab-manager/src/lib/state/auth.svelte.ts` - extension auth consumer
- `apps/zhongwen/src/lib/auth.ts` - plain auth outlier
