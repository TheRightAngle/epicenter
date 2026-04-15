# Using trySync/tryAsync in HTTP Handlers

## When to Read This

Read when implementing route handlers (Elysia, Express, SvelteKit, etc.) that should convert caught errors directly into HTTP status responses.

## Using trySync/tryAsync in HTTP Handlers

Not all error handling involves propagating `Result` types up a service chain. In HTTP route handlers (Elysia, Express, SvelteKit, etc.), you often want to convert errors directly into HTTP status responses. The same trySync/tryAsync patterns apply; you just return a status response instead of `Err(...)`.

### The Pattern: trySync → early return with status

```typescript
// From packages/server/src/ai/plugin.ts — Elysia route handler
async ({ body, headers, status }) => {
	// Validation guards use return status() directly
	if (!isSupportedProvider(provider)) {
		return status('Bad Request', `Unsupported provider: ${provider}`);
	}

	// Wrap only the call that can throw — chat() may fail on bad adapter config.
	// toServerSentEventsResponse() is pure construction and never throws.
	const { data: stream, error: chatError } = trySync({
		try: () =>
			chat({
				adapter,
				messages,
				abortController,
			}),
		catch: (e) => Err(e instanceof Error ? e : new Error(String(e))),
	});

	if (chatError) {
		if (chatError.name === 'AbortError' || abortController.signal.aborted) {
			return status(499, 'Client closed request');
		}
		return status('Bad Gateway', `Provider error: ${chatError.message}`);
	}

	// Happy path — stream is guaranteed non-null after the error check
	return toServerSentEventsResponse(stream, { abortController });
};
```

### Key Differences from Service-Layer Usage

| Service layer                                  | HTTP handler                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `catch: (e) => ServiceErr({ message: '...' })` | `catch: (e) => Err(e instanceof Error ? e : new Error(String(e)))` |
| `if (error) return Err(error)`                 | `if (error) return status(502, error.message)`                     |
| Propagates typed errors up the chain           | Converts errors to HTTP responses immediately                      |
| Caller decides what to do with the error       | Handler IS the final caller                                        |

In HTTP handlers, you're the last stop. There's no caller above you to propagate to; you convert the error into a response and return it. The trySync pattern still gives you linear control flow and surgical error boundaries—you just use `return status(...)` instead of `return Err(...)`.

### Refactoring try-catch to trySync in Handlers

Before (try-catch with throw):

```typescript
try {
	const result = riskyCall();
	return buildResponse(result);
} catch (error) {
	const message = error instanceof Error ? error.message : 'Unknown error';
	throw status(500, message);
}
```

After (trySync with early return):

```typescript
const { data: result, error } = trySync({
	try: () => riskyCall(),
	catch: (e) => Err(e instanceof Error ? e : new Error(String(e))),
});

if (error) return status(500, error.message);

return buildResponse(result);
```

The trySync version wraps only the risky call, uses `return` consistently (no `throw` vs `return` mismatch), and keeps the happy path at the bottom of the function.
