# Your SPA Singleton Doesn't Need $effect Cleanup

If you're building a single-page application in Svelte 5, you can skip `$effect` for global listeners entirely. Module-level singletons live as long as the page does, and the page dying is your cleanup.

Here's a real storage wrapper from a browser extension. It calls `item.watch()` to sync state from other tabs, with no `$effect`, no teardown, no cleanup function:

```typescript
export function createStorageState<TSchema extends StandardSchemaV1>(
  key: StorageItemKey,
  { fallback, schema }: { fallback: T; schema: TSchema },
) {
  let value = $state<T>(fallback);

  void item.getValue().then((persisted) => {
    value = validate(persisted) ?? fallback;
  });

  // No $effect. No cleanup. Just a listener that lives forever.
  item.watch((newValue) => {
    value = validate(newValue) ?? fallback;
  });

  return {
    get current(): T { return value; },
    set current(newValue: T) {
      value = newValue;
      void item.setValue(newValue);
    },
  };
}
```

Called once at module scope, exported as a constant:

```typescript
export const serverUrl = createStorageState('local:serverUrl', {
  fallback: 'https://api.epicenter.so',
  schema: type('string'),
});
```

That `item.watch()` listener never gets removed. It doesn't need to. The module loads once, the singleton lives for the entire session, and when the user closes the tab, the JavaScript context dies and takes everything with it.

## $effect can't even run at module scope

The instinct to reach for `$effect` here actually hits a wall. Svelte 5 throws an `effect_orphan` error if you call `$effect` outside a component's initialization:

```typescript
// This throws: effect_orphan
export function createStorageState(...) {
  $effect(() => {
    const unwatch = item.watch(...);
    return unwatch; // never runs because it never starts
  });
}
```

You'd need `$effect.root` to make it work, which returns a manual destroy function. Now you have to track that destroy function, call it somewhere, and manage lifecycle for something that was already going to live forever. You've traded zero code for boilerplate that does nothing useful.

## The same pattern works with plain DOM events

`createPersistedState` does the same thing with `window.addEventListener`. Two listeners, no cleanup:

```typescript
export function createPersistedState({ key, schema, onParseError }) {
  let value = $state(parseValueFromStorage(localStorage.getItem(key)));

  window.addEventListener('storage', (e) => {
    if (e.key !== key) return;
    value = parseValueFromStorage(e.newValue);
  });

  window.addEventListener('focus', () => {
    value = parseValueFromStorage(localStorage.getItem(key));
  });

  return {
    get value() { return value; },
    set value(newValue) {
      value = newValue;
      localStorage.setItem(key, JSON.stringify(newValue));
    },
  };
}
```

`storage` and `focus` events on `window` for a singleton that never unmounts. The listeners are intentionally immortal because the thing they serve is immortal.

## It's not just DOM events—subscription APIs work the same way

The pattern extends beyond `window.addEventListener`. Here's how workspace settings sync Yjs CRDT changes into a reactive SvelteMap:

```typescript
function createWorkspaceSettings() {
  const map = new SvelteMap<string, unknown>();

  for (const key of Object.keys(KV_DEFINITIONS) as KvKey[]) {
    map.set(key, workspace.kv.get(key));
  }

  // Observer fires on local writes AND remote sync from other devices.
  // No unsubscribe call. Ever.
  workspace.kv.observeAll((changes) => {
    for (const [key, change] of changes) {
      if (change.type === 'set') {
        map.set(key, change.value);
      } else if (change.type === 'delete') {
        map.set(key, workspace.kv.get(key));
      }
    }
  });

  return {
    get(key) { return map.get(key); },
    set(key, value) { workspace.kv.set(key, value); },
  };
}

export const settings = createSettings();
```

`observeAll` returns an unsubscribe function. We throw it away. The observer feeds the SvelteMap, the SvelteMap feeds components, and the whole chain lives exactly as long as the app does. The three patterns—`item.watch()`, `window.addEventListener`, and `kv.observeAll`—are structurally identical: subscribe once, never unsubscribe, let process exit handle teardown.

For a deeper walkthrough of this pattern across different subscription APIs, see [Module-Level Singletons Don't Need removeEventListener](./module-level-singletons-dont-need-remove-event-listener.md).

## When this breaks: components that mount and unmount

The one scenario where you'd actually leak is calling these functions inside a component that gets created and destroyed during navigation. Each mount adds listeners that never get removed. If you navigated back and forth 50 times, you'd have 50 `storage` listeners all firing and updating a `$state` variable that only the latest component instance reads.

In practice, even that's mostly harmless for lightweight events like `storage` and `focus`. The old listeners update dead `$state` bindings that nothing renders. But it's not clean, and for heavier subscriptions like WebSocket connections, it would be a real problem.

The fix is simple: only call these at module scope. The function creates a singleton; use it like one.

## SPAs make this safe because hydration happens once

Server-rendered apps remount components constantly. Each navigation could destroy and recreate the component tree, and any listener without cleanup would accumulate. That's why the Svelte docs emphasize `$effect` teardown so heavily.

SPAs are different. The shell loads once. SvelteKit in SPA mode hydrates once. Module-level code runs once. Your singleton initializes once and stays alive until the tab closes. There's no server-side context to worry about, no hydration mismatch, no component lifecycle to respect. The module IS the lifecycle.

This is increasingly a niche concern since fewer apps are pure SPAs these days. But if yours is one—a browser extension popup, a Tauri desktop app, an internal tool—the module singleton pattern is the simplest reactive primitive you can build. No `$effect`, no `onDestroy`, no `createSubscriber`. Just `$state` and a listener that lives as long as the page does.
