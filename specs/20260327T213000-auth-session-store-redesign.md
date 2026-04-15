# Auth Session Store Redesign

**Date**: 2026-03-27
**Status**: Implemented
**Author**: AI-assisted

## Overview

Replace the current shared auth singleton with a smaller session-centered architecture: a pure Better Auth transport layer, a Svelte auth session store, and injected side effects for workspace lifecycle reactions. The redesign should make the persisted session snapshot the only auth source of truth and remove workspace ownership from the auth core.

## Motivation

### Current State

Today the shared auth helper lives in `packages/svelte-utils/src/auth.svelte.ts` and owns transport, persisted session state, UI operation state, token notifications, and workspace lifecycle side effects.

The current public shape is roughly:

```typescript
type Auth = {
  readonly whenReady: Promise<StoredUser | null>;
  readonly state: AuthState;
  readonly status: AuthStatus;
  readonly user: StoredUser | null;
  readonly token: string | null;
  readonly signInError?: string;
  onTokenChange(listener: (token: string | null) => void): () => void;
  refreshSession(): Promise<StoredUser | null>;
  signIn(credentials: { email: string; password: string }): Promise<void>;
  signUp(credentials: { email: string; password: string; name: string }): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  fetch: typeof fetch;
};
```

The constructor also takes a workspace dependency:

```typescript
createAuth({
  baseURL,
  session,
  workspace,
  signInWithGoogle,
})
```

The shared module currently:

1. Builds Better Auth clients and reads `set-auth-token` headers
2. Persists the auth session snapshot
3. Derives UI-facing auth status
4. Unlocks workspace encryption after successful auth
5. Clears local workspace data after sign-out or invalid session
6. Publishes token change notifications for sync clients

This creates problems:

1. **Too many responsibilities in one module.** The shared auth helper owns transport, persistence, state transitions, and workspace side effects.
2. **Identity state and operation state are conflated.** `status` currently mixes who the user is with what operation is in flight.
3. **Workspace is a hard dependency of auth.** The auth core cannot exist without a workspace handle, even for apps that may not want workspace behavior.
4. **Cross-context behavior is harder to reason about than it should be.** The module manages storage writes, storage listeners, token notifications, and workspace effects together.
5. **Better Auth integration details leak upward.** Client construction, bearer token handling, and custom-session response parsing live in the main auth state module.

### Desired State

The target architecture should separate concerns like this:

```typescript
const transport = createAuthTransport({
  baseURL,
  signInWithGoogle,
});

const auth = createAuthSession({
  storage: persistedSession,
  transport,
  onSessionCommitted: async ({ previous, current }) => {
    if (
      previous.status !== 'authenticated' &&
      current.status === 'authenticated'
    ) {
      await workspace.encryption.tryUnlock();
      return;
    }

    if (
      previous.status === 'authenticated' &&
      current.status === 'anonymous'
    ) {
      await workspace.clearLocalData();
    }
  },
});
```

The public auth surface should be session-centered:

```typescript
type AuthSession =
  | { status: 'anonymous' }
  | { status: 'authenticated'; token: string; user: StoredUser };

type AuthOperation =
  | { status: 'idle' }
  | { status: 'bootstrapping' }
  | { status: 'refreshing' }
  | { status: 'signing-in' }
  | { status: 'signing-out' };
```

## Research Findings

### The Current Complexity Comes From Ownership, Not Transition Syntax

The current module already has a manageable number of auth states. The real complexity comes from one module owning:

- Better Auth transport setup
- persisted session storage
- token change publication
- workspace unlock and wipe policy
- UI-facing operation and error state

**Key finding**: The main smell is not that auth lacks a formal state machine library. The main smell is that the current module is a control-flow bottleneck for unrelated concerns.

**Implication**: The first redesign should separate ownership boundaries before considering a formal state machine library.

### Persisted Session Is the Right Storage Unit

The current codebase already moved away from independently persisted `user` and `token` fields toward a single persisted session snapshot. That change established the correct persistence invariant:

```typescript
type PersistedSession =
  | { status: 'anonymous' }
  | { status: 'authenticated'; token: string; user: StoredUser };
```

**Key finding**: Session persistence should stay atomic. Future control-flow changes should build on this invariant rather than reintroducing split roots.

**Implication**: All auth operations should compute and commit a next session snapshot exactly once.

### Workspace Side Effects Belong Behind an Injected Boundary

The workspace behavior is real and important:

- unlock encrypted runtime after a newly authenticated session
- clear local data after sign-out or invalid session

But that does not mean the auth core should import workspace directly.

**Key finding**: The cleanest separation is not a permanent “workspace bridge” abstraction with its own public lifecycle. The cleanest separation is an injected session-commit side-effect hook.

**Implication**: Auth should publish session transitions; apps decide what those transitions mean for workspace.

### XState Solves a Different Problem Than the One We Have Today

XState would help if auth were dominated by multi-step flows such as:

- MFA enrollment and challenge flows
- email verification branches
- passkey fallback logic
- device authorization polling and cancellation
- explicit timeout and retry policies

That is not the dominant complexity today.

**Key finding**: XState would formalize the state machine, but it would not by itself solve mixed ownership between transport, storage, workspace, and UI concerns.

**Implication**: XState is a possible future move, but it should not be the first redesign step.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Primary auth truth | `AuthSession` union with `anonymous` and `authenticated` variants | Encodes the real invariant directly |
| Operation modeling | Separate `AuthOperation` union | Keeps identity and in-flight work distinct |
| Transport boundary | Dedicated `createAuthTransport()` | Keeps Better Auth wiring out of the state module |
| Workspace coupling | Dependency injection via `onSessionCommitted` with commit metadata | Keeps auth core small while still carrying auth-adjacent facts like `reason` and `userKeyBase64` to app-owned workspace effects |
| Token notifications | Keep `onTokenChange()` on the auth session store | Sync clients depend on this seam today |
| Convenience accessors | Keep `user`, `token`, and `isAuthenticated` as projections | Ergonomic reads without creating parallel state roots |
| Authorized fetch | Keep `fetch` on the auth session store for now | Minimizes migration cost; can be split later if still awkward |
| Error modeling | Explicit command-local `Result<void, AuthError>` returns for sign-in flows | Keeps forms specific without turning the session store into a shared UI error bucket |
| Compatibility strategy | Clean break to `createAuthSession` / `createAuthTransport` with caller migration | Keeps the public surface honest and avoids re-hiding the old god-object behind a compatibility shim |
| State machine library | Do not introduce XState in this redesign | Ownership boundaries are the primary problem today |

## Architecture

The recommended architecture is:

```text
┌──────────────────────────────────────────────────────────────┐
│ App auth setup                                              │
│                                                              │
│  persisted session storage                                   │
│  Better Auth transport configuration                         │
│  injected session side effects                               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ createAuthSession(...)                                       │
│                                                              │
│  - owns AuthSession                                          │
│  - owns AuthOperation                                        │
│  - exposes commands                                          │
│  - exposes projections                                       │
│  - publishes session/token change events                     │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
┌──────────────────────────────┐   ┌───────────────────────────┐
│ createAuthTransport(...)     │   │ injected onSessionCommitted│
│                              │   │                           │
│  - Better Auth client        │   │  app-specific reactions   │
│  - bearer token parsing      │   │  to session transitions   │
│  - sign-in / sign-out calls  │   │                           │
└──────────────────────────────┘   └───────────────────────────┘
```

### Before

```text
auth.svelte.ts
├── Better Auth transport
├── persisted storage
├── AuthStatus state machine
├── token pub/sub
├── workspace unlock
├── workspace clearLocalData
└── fetch helper
```

### After

```text
auth-transport.ts
└── Better Auth details only

auth-session.svelte.ts
├── session snapshot
├── operation
├── commands
├── projections
└── notifications

app wiring
└── injected session side effects
```

### Control Flow

```text
STEP 1: Bootstrap
────────────────────
1. Auth session store awaits persisted session storage readiness
2. If persisted session is anonymous, operation becomes idle
3. If persisted session is authenticated, auth store optionally refreshes or
   validates the server session
4. Store commits the resulting session snapshot once
5. Injected session side effects react to the committed transition

STEP 2: Explicit Sign-In / Sign-Up
───────────────────────────────────
1. Auth session store sets operation to signing-in
2. Transport performs remote Better Auth call
3. Transport returns a remote session payload
4. Auth session store converts payload to `AuthSession`
5. Auth session store commits the new session snapshot once
6. Injected side effects react to the transition
7. Operation becomes idle

STEP 3: Refresh
────────────────────
1. Auth session store sets operation to refreshing
2. Transport performs `getSession`
3. Store maps response to:
   - authenticated session
   - anonymous session
   - no change on transient failure
4. Store commits at most one snapshot
5. Operation becomes idle

STEP 4: Sign-Out
────────────────────
1. Auth session store sets operation to signing-out
2. Transport calls remote sign-out
3. Store commits `{ status: 'anonymous' }`
4. Injected side effects react to the transition
5. Operation becomes idle
```

## Proposed Public API

### Core Types

```typescript
export type AuthSession =
  | { status: 'anonymous' }
  | { status: 'authenticated'; token: string; user: StoredUser };

export type AuthOperation =
  | { status: 'idle' }
  | { status: 'bootstrapping' }
  | { status: 'refreshing' }
  | { status: 'signing-in' }
  | { status: 'signing-out' };

export type AuthSessionStorage = {
  readonly current: AuthSession;
  set(value: AuthSession): void | Promise<void>;
  watch(callback: (value: AuthSession) => void): (() => void) | undefined;
  whenReady?: Promise<void>;
};
```

### Transport

```typescript
export type RemoteAuthResult =
  | { status: 'authenticated'; token: string; user: StoredUser; userKeyBase64?: string | null }
  | { status: 'anonymous' }
  | { status: 'unchanged' };

export type AuthTransport = {
  getSession(current: AuthSession): Promise<RemoteAuthResult>;
  signIn(input: { email: string; password: string }): Promise<RemoteAuthResult>;
  signUp(input: { email: string; password: string; name: string }): Promise<RemoteAuthResult>;
  signInWithGoogle(): Promise<RemoteAuthResult>;
  signOut(current: AuthSession): Promise<void>;
};
```

### Session Store

```typescript
export type CreateAuthSessionOptions = {
  storage: AuthSessionStorage;
  transport: AuthTransport;
  onSessionCommitted?: (args: {
    previous: AuthSession;
    current: AuthSession;
    reason:
      | 'bootstrap'
      | 'refresh'
      | 'sign-in'
      | 'sign-up'
      | 'google-sign-in'
      | 'sign-out'
      | 'external-change';
    userKeyBase64?: string | null;
  }) => void | Promise<void>;
};

export type AuthSessionStore = {
  readonly whenReady: Promise<void>;
  readonly session: AuthSession;
  readonly operation: AuthOperation;
  readonly isAuthenticated: boolean;
  readonly user: StoredUser | null;
  readonly token: string | null;

  refresh(): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<Result<void, AuthError>>;
  signUp(input: { email: string; password: string; name: string }): Promise<Result<void, AuthError>>;
  signInWithGoogle(): Promise<Result<void, AuthError>>;
  signOut(): Promise<void>;

  onSessionChange(listener: (session: AuthSession) => void): () => void;
  onTokenChange(listener: (token: string | null) => void): () => void;

  fetch: typeof fetch;
};
```

Example call site:

```typescript
const { error } = await auth.signIn({ email, password });
if (error) {
  formError = error.message;
}
```

> **Implementation note**: email/password and custom Google sign-in now hydrate the
> canonical authenticated session through `getSession()` after the Better Auth
> sign-in call completes. This is necessary because the server's custom
> `encryptionKey` field is exposed on `getSession()` responses, not on
> sign-in/sign-up responses.

### Example App Wiring

```typescript
const session = createPersistedState({
  key: 'honeycrisp:authSession',
  schema: AuthSessionSchema,
  defaultValue: { status: 'anonymous' },
});

const transport = createAuthTransport({
  baseURL: APP_URLS.API,
});

export const authState = createAuthSession({
  storage: session,
  transport,
  onSessionCommitted: async ({ previous, current }) => {
    if (
      previous.status !== 'authenticated' &&
      current.status === 'authenticated'
    ) {
      await workspace.encryption.tryUnlock();
      return;
    }

    if (
      previous.status === 'authenticated' &&
      current.status === 'anonymous'
    ) {
      await workspace.clearLocalData();
    }
  },
});
```

## File Layout Proposal

```text
packages/svelte-utils/src/
├── auth.ts                         // public exports
├── auth-session.svelte.ts          // createAuthSession, AuthSessionStore
├── auth-transport.ts               // createAuthTransport, Better Auth wiring
└── auth-types.ts                   // shared schemas and types
```

Compatibility option:

```text
packages/svelte-utils/src/auth.svelte.ts
└── compatibility wrapper that re-exports from auth-session/auth-types
```

App wiring stays local:

```text
apps/honeycrisp/src/lib/auth/index.ts
apps/opensidian/src/lib/auth/index.ts
apps/tab-manager/src/lib/state/auth.svelte.ts
apps/zhongwen/src/lib/auth.ts
```

## Implementation Plan

### Phase 1: Introduce the new auth primitives

- [x] **1.1** Create shared `AuthSession` schema and types in a dedicated auth types module
- [x] **1.2** Introduce `AuthOperation` as a separate union from `AuthSession`
- [x] **1.3** Define `AuthTransport` and `RemoteAuthResult` contracts
- [x] **1.4** Move Better Auth client construction and header parsing into `createAuthTransport()`

### Phase 2: Implement the session-centered store

- [x] **2.1** Create `createAuthSession()` in a new `.svelte.ts` file
- [x] **2.2** Make persisted `AuthSession` the only auth source of truth
- [x] **2.3** Add `onSessionChange()` and `onTokenChange()` notifications
- [x] **2.4** Separate `operation` from `session`
- [x] **2.5** Preserve convenience projections: `user`, `token`, `isAuthenticated`, `fetch`

### Phase 3: Inject app-specific side effects

- [x] **3.1** Remove direct workspace dependency from the auth core
- [x] **3.2** Add `onSessionCommitted` injection point
- [x] **3.3** Wire workspace unlock / clear reactions from each app entrypoint
- [x] **3.4** Ensure sync clients still reconnect through token change notifications

### Phase 4: Migrate app entrypoints

- [x] **4.1** Update Honeycrisp auth wiring to use transport + session store + injected side effects
- [x] **4.2** Update Opensidian auth wiring
- [x] **4.3** Update Zhongwen auth wiring
- [x] **4.4** Update Tab Manager auth wiring, preserving custom Google auth behavior

### Phase 5: Compatibility cleanup

- [x] **5.1** Decide whether to keep `createAuth` as an alias or fully rename to `createAuthSession`
  > **Note**: Chose the clean-break option and updated callers to the new API instead of preserving a compatibility alias.
- [x] **5.2** Remove obsolete helper logic from the old auth module
- [x] **5.3** Update package exports and references
- [x] **5.4** Add or update docs for the new auth API

## Edge Cases

### Persisted Authenticated Session, Server Session Expired

1. Storage loads `{ status: 'authenticated', token, user }`
2. Bootstrap calls `transport.getSession()`
3. Remote auth returns anonymous or a 4xx-invalid session result
4. Store commits `{ status: 'anonymous' }`
5. Injected side effects clear local workspace data

### External Sign-Out in Another Context

1. Another tab or extension context commits `{ status: 'anonymous' }`
2. Storage watch fires in this context
3. Session store updates local session snapshot
4. Session and token listeners fire
5. Injected side effects react to authenticated → anonymous

### External Sign-In in Another Context

1. Another context commits `{ status: 'authenticated', ... }`
2. Storage watch fires here
3. Session store updates local session snapshot
4. Token listeners fire with the new token
5. Injected side effects react to anonymous → authenticated

### Google Sign-In Cancellation

1. Transport initiates custom Google flow
2. User cancels or closes the auth window
3. Transport returns an error or no-change result
4. Store keeps current session snapshot
5. Operation returns to idle without clearing session

### `onSessionCommitted` Failure

1. Store commits a valid next auth session
2. Injected side effect throws while unlocking or clearing workspace
3. Auth session state remains committed
4. Error handling policy decides whether to surface the failure to the explicit caller, log it as a background auth error, or route it to app-specific UI

Recommendation: do not roll back the committed auth session. Session state and workspace state are separate concerns; the side effect failure should be reported, not undone via compensating auth writes.

## Open Questions

1. **Should `fetch` remain on the auth session store?**
   - Options: (a) keep it on `auth`, (b) move it to `createAuthorizedFetch({ getToken })`, (c) let apps build their own
   - **Recommendation**: keep it on `auth` for the first redesign, then reevaluate once the auth core is smaller

2. **Should `createAuth` remain as a compatibility export?**
   - Options: (a) keep `createAuth` as an alias, (b) rename to `createAuthSession` immediately, (c) export both during migration
   - **Implemented**: renamed immediately and updated callers in the same change

3. **How should auth form errors be modeled?**
   - Options: (a) keep one shared field, (b) move command errors to caller-local form state, (c) keep transport/session errors shared but not form validation errors
   - **Implemented**: explicit command-local `Result` returns for sign-in flows, with forms owning their displayed error state

## Review

**Completed**: 2026-03-27

### Summary

The auth core is now split into dedicated auth types, a Better Auth transport module, and a session-centered Svelte store. All app entrypoints now compose transport plus injected workspace side effects locally, and runtime callers now read `session` / `operation` directly while explicit auth operations return typed `Result`s for form-specific failures.

### Deviations from Spec

- `onSessionCommitted` carries `reason` and optional `userKeyBase64` so app-owned workspace effects can unlock with the actual remote encryption key when available.
- The implementation intentionally made a clean caller-breaking rename instead of keeping `createAuth` as an alias.
- Email/password and custom Google sign-in hydrate the canonical authenticated snapshot through `getSession()` after sign-in so the store can obtain the server-provided encryption key.
- Shared `lastError` auth UI state was replaced with typed operation results so forms render only the failures from the operation they just ran.

### Verification Notes

- Targeted auth caller migration was checked after implementation.
- Full repo typecheck is still blocked by unrelated preexisting failures in `apps/fuji`, `packages/workspace`, and several app-local UI path-resolution/type issues outside this auth redesign.

4. **Should XState be introduced after this split?**
   - Options: (a) no, stay with explicit Svelte state, (b) yes immediately after the split, (c) defer until MFA / passkey / polling flows exist
   - **Recommendation**: defer until those richer flows actually exist

5. **Should legacy `authToken` / `authUser` storage keys be migrated automatically?**
   - Options: (a) no migration, require re-auth, (b) one-time read + rewrite on startup, (c) app-specific migration only where cheap
   - **Recommendation**: choose (c); migrate only where the old keys are easy to read synchronously or cheaply

## Success Criteria

- [ ] Auth core no longer imports or depends on workspace
- [ ] Better Auth client setup lives outside the auth session store
- [ ] Persisted `AuthSession` is the only auth source of truth
- [ ] Identity state and operation state are modeled separately
- [ ] Apps inject workspace side effects instead of auth owning them directly
- [ ] Existing sync clients still work through `onTokenChange()`
- [ ] Tab Manager preserves its custom Google sign-in flow
- [ ] New auth API is documented and usable from multiple apps without copying logic

## References

- `packages/svelte-utils/src/auth.svelte.ts` - current shared auth implementation
- `apps/tab-manager/src/lib/state/auth.svelte.ts` - extension-specific auth wiring and custom Google flow
- `apps/honeycrisp/src/lib/auth/index.ts` - web app auth wiring
- `apps/opensidian/src/lib/auth/index.ts` - web app auth wiring
- `apps/zhongwen/src/lib/auth.ts` - web app auth wiring
- `apps/honeycrisp/src/lib/workspace/client.svelte.ts` - sync consumer of `auth.token` and `onTokenChange`
- `apps/tab-manager/src/lib/workspace/client.svelte.ts` - sync consumer of `auth.token` and `onTokenChange`
- `specs/20260325T230903-auth-surface-simplification.md` - related auth surface simplification discussion
- `specs/20260326T080519-workspace-auth-isolation.md` - related auth/workspace boundary thinking
- `specs/20260326T120000-auth-workspace-encryption-boundary.md` - related encryption boundary discussion
