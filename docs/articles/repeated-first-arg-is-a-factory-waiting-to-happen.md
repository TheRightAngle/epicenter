# Repeated First Argument Is a Factory Waiting to Happen

When two sibling functions share the same first argument, they're telling you they belong together. The repeated parameter is a dependency that should be closed over once, not threaded through every call.

```typescript
//                          ↓ repeated
async function requestDeviceCode(serverUrl: string) {
	return post(`${serverUrl}/auth/device/code`, { client_id: CLIENT_ID });
}

//                           ↓ repeated
async function pollDeviceToken(serverUrl: string, deviceCode: string) {
	return post(`${serverUrl}/auth/device/token`, {
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
		device_code: deviceCode,
		client_id: CLIENT_ID,
	});
}
```

The call site repeats `serverUrl` on every invocation:

```typescript
const codeData = await requestDeviceCode(serverUrl);   // ← serverUrl
// ...
const tokenData = await pollDeviceToken(serverUrl, deviceCode); // ← same value again
```

`serverUrl` is the same value both times. It's not method-specific—it's the shared context these functions operate in.

## The fix: close over the shared dependency

Wrap the sibling functions in a factory that takes the shared argument once. The private helper (`post`) moves inside too—it was already coupled to the same server.

```typescript
function createServerApi(serverUrl: string) {  // ← one place, closed over
	// Private helper — also used serverUrl; now it's just a closure variable
	async function post(path: string, body: Record<string, string>) {
		const res = await fetch(`${serverUrl}${path}`, {  // ← reads from closure
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return res.json() as Promise<Record<string, unknown>>;
	}

	return {
		requestDeviceCode() {  // ← no serverUrl parameter
			return post('/auth/device/code', { client_id: CLIENT_ID });
		},

		pollDeviceToken(deviceCode: string) {  // ← only what varies per call
			return post('/auth/device/token', {
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: deviceCode,
				client_id: CLIENT_ID,
			});
		},
	};
}
```

The call site reads like named RPC calls on a bound client:

```typescript
const api = createServerApi(serverUrl);           // ← bound once
const codeData = await api.requestDeviceCode();   // ← no serverUrl
// ...
const tokenData = await api.pollDeviceToken(deviceCode); // ← no serverUrl
```

`serverUrl` appears once. Each method's signature now contains only what varies per call.

The diff tells the same story:

```diff
 // Function signatures
-async function requestDeviceCode(serverUrl: string)
-async function pollDeviceToken(serverUrl: string, deviceCode: string)
+function createServerApi(serverUrl: string) {
+  return {
+    requestDeviceCode()
+    pollDeviceToken(deviceCode: string)
+  }
+}

 // Call sites
-const codeData = await requestDeviceCode(serverUrl);
-const tokenData = await pollDeviceToken(serverUrl, deviceCode);
+const api = createServerApi(serverUrl);
+const codeData = await api.requestDeviceCode();
+const tokenData = await api.pollDeviceToken(deviceCode);
```

`serverUrl` moves from being passed N times to being passed once.

## How to spot this

The code smell is mechanical: scan your standalone functions for a shared first parameter. When two or more functions take the same first argument—a URL, a database client, an SDK instance—they're siblings that belong in a factory.

| Smell | Fix |
|---|---|
| `fn1(db, ...)` and `fn2(db, ...)` | `createService(db)` → `{ fn1(...), fn2(...) }` |
| `fn1(serverUrl, ...)` and `fn2(serverUrl, ...)` | `createApi(serverUrl)` → `{ fn1(...), fn2(...) }` |
| `fn1(doc, ...)` and `fn2(doc, ...)` | `createStore(doc)` → `{ fn1(...), fn2(...) }` |

The shared parameter becomes the factory's single argument. Any helper that was also using that parameter (`post` in the example above) moves inside the factory body as a private function.

This is a special case of the broader [Stop Passing Clients as Arguments](./stop-passing-clients-as-arguments.md) principle—but the trigger is even more obvious. You don't need to think about "is this a client?" Just look for the repeated first argument.
