# Auth Token Change → Sync Reconnect

## Problem

After signing in on tab-manager (and honeycrisp, opensidian), the user must manually click "Reconnect" because sync doesn't auto-reconnect.

The sync extension has a designed `onTokenChange` hook for exactly this, but no app wires it. Instead, `onLogin`/`onLogout` manually call `reconnect()`—which either silently fails (if `unlockWithKey` throws first) or has a timing gap.

## Fix

Two changes:

### 1. Add `onTokenChange` to `AuthClient` (`create-auth.svelte.ts`)

Expose a method that subscribes to token transitions. Fires when the token changes (sign-in, sign-out, session refresh). Returns an unsubscribe function. Matches the `SyncExtensionConfig.onTokenChange` signature exactly so it can be passed directly.

```typescript
// On AuthClient type:
onTokenChange(callback: () => void): () => void;

// Usage:
createSyncExtension({
  url: ...,
  getToken: async () => auth.token,
  onTokenChange: auth.onTokenChange,
})
```

Implementation: track `previousToken` inside `useSession.subscribe`. When token changes, notify all registered listeners.

### 2. Wire `onTokenChange` in tab-manager's sync extension config (`client.ts`)

Pass `auth.onTokenChange` to the sync extension. Remove the now-redundant manual `reconnect()` calls from `onLogin` and `onLogout`.

Before:
```typescript
createSyncExtension({
  url: (workspaceId) => `${serverUrl.current}/workspaces/${workspaceId}`,
  getToken: async () => auth.token,
})
// ...
onLogin(session) {
  workspace.unlockWithKey(session.userKeyBase64);
  workspace.extensions.sync.reconnect();  // manual, fragile
},
onLogout() {
  workspace.clearLocalData();
  workspace.extensions.sync.reconnect();  // manual, fragile
},
```

After:
```typescript
createSyncExtension({
  url: (workspaceId) => `${serverUrl.current}/workspaces/${workspaceId}`,
  getToken: async () => auth.token,
  onTokenChange: auth.onTokenChange,
})
// ...
onLogin(session) {
  workspace.unlockWithKey(session.userKeyBase64);
  // reconnect handled by onTokenChange
},
onLogout() {
  workspace.clearLocalData();
  // reconnect handled by onTokenChange
},
```

## Todo

- [ ] Add `onTokenChange` to `AuthClient` type in `create-auth.svelte.ts`
- [ ] Implement token change tracking + listener notification in `createAuth`
- [ ] Wire `onTokenChange: auth.onTokenChange` in tab-manager's `client.ts`
- [ ] Remove manual `reconnect()` from tab-manager's `onLogin`/`onLogout`
- [ ] Run typecheck

## Out of scope (but noted)

- `apps/honeycrisp/src/lib/client.ts` has the same manual `reconnect()` pattern
- `apps/opensidian/src/lib/client.ts` has the same manual `reconnect()` pattern

Same fix applies to both—can do in a follow-up.
