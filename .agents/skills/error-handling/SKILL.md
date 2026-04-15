---
name: error-handling
description: Error handling patterns using wellcrafted trySync and tryAsync. Use when writing or reviewing try-catch blocks, refactoring try-catch to linear control flow, working with Result types, or returning HTTP error responses from route handlers.
metadata:
  author: epicenter
  version: '2.0'
---

# Error Handling with wellcrafted trySync and tryAsync

## When to Apply This Skill

Use this pattern when you need to:

- Replace recoverable `try-catch` blocks with `trySync` or `tryAsync`.
- Handle fallback success paths via `Ok(...)` and propagate failures with `Err(...)`.
- Wrap caught exceptions as `cause` for typed domain error constructors.
- Refactor nested error branches into immediate-return linear control flow.
- Convert handler failures into HTTP status responses with explicit guards.

## References

Load these on demand based on what you're working on:

- If working with **wrapping boundaries, minimal vs extended wrapping, or immediate-return control flow**, read [references/wrapping-patterns.md](references/wrapping-patterns.md)
- If working with **real-world codebase examples and wrapping scenario guidelines**, read [references/real-world-examples.md](references/real-world-examples.md)
- If working with **HTTP route handlers and status-response error conversion**, read [references/http-handlers.md](references/http-handlers.md)

## Use trySync/tryAsync Instead of try-catch for Graceful Error Handling

When handling errors that can be gracefully recovered from, use `trySync` (for synchronous code) or `tryAsync` (for asynchronous code) from wellcrafted instead of traditional try-catch blocks. This provides better type safety and explicit error handling.

> **Related Skills**: See `services-layer` skill for `defineErrors` patterns and service architecture. See `query-layer` skill for error transformation to `WhisperingError`.

### The Pattern

```typescript
import { trySync, tryAsync, Ok, Err } from 'wellcrafted/result';

// SYNCHRONOUS: Use trySync for sync operations
const { data, error } = trySync({
	try: () => {
		const parsed = JSON.parse(jsonString);
		return validateData(parsed); // Automatically wrapped in Ok()
	},
	catch: (e) => {
		// Gracefully handle parsing/validation errors
		console.log('Using default configuration');
		return Ok(defaultConfig); // Return Ok with fallback
	},
});

// ASYNCHRONOUS: Use tryAsync for async operations
await tryAsync({
	try: async () => {
		const child = new Child(session.pid);
		await child.kill();
		console.log(`Process killed successfully`);
	},
	catch: (e) => {
		// Gracefully handle the error
		console.log(`Process was already terminated`);
		return Ok(undefined); // Return Ok(undefined) for void functions
	},
});

// Both support the same catch patterns
const syncResult = trySync({
	try: () => riskyOperation(),
	catch: (error) => {
		// For recoverable errors, return Ok with fallback value
		return Ok('fallback-value');
		// For unrecoverable errors, pass the raw cause — the constructor handles extractErrorMessage
		return CompletionError.ConnectionFailed({ cause: error });
	},
});
```

### Key Rules

1. **Choose the right function** - Use `trySync` for synchronous code, `tryAsync` for asynchronous code
2. **Always await tryAsync** - Unlike try-catch, tryAsync returns a Promise and must be awaited
3. **trySync returns immediately** - No await needed for synchronous operations
4. **Match return types** - If the try block returns `T`, the catch should return `Ok<T>` for graceful handling
5. **Use Ok(undefined) for void** - When the function returns void, use `Ok(undefined)` in the catch
6. **Return Err for propagation** - Use custom error constructors that return `Err` when you want to propagate the error
7. **Transform cause in the constructor, not the call site** - When wrapping a caught error, pass the raw error as `cause: unknown` and let the `defineErrors` constructor call `extractErrorMessage(cause)` inside its message template. Don't call `extractErrorMessage` at the call site. This centralizes message extraction where the message is composed:

```typescript
// ✅ GOOD: cause: error at call site, extractErrorMessage in constructor
catch: (error) => CompletionError.ConnectionFailed({ cause: error })

// ❌ BAD: extractErrorMessage at call site, string passed to constructor
catch: (error) => CompletionError.ConnectionFailed({ underlyingError: extractErrorMessage(error) })
```

8. **CRITICAL: Wrap destructured errors with Err()** - When you destructure `{ data, error }` from tryAsync/trySync, the `error` variable is the raw error value, NOT wrapped in `Err`. You must wrap it before returning:

```typescript
// WRONG - error is just the raw error value, not a Result
const { data, error } = await tryAsync({...});
if (error) return error; // TYPE ERROR: Returns raw error, not Result

// CORRECT - wrap with Err() to return a proper Result
const { data, error } = await tryAsync({...});
if (error) return Err(error); // Returns Err<CustomError>
```

This is different from returning the entire result object:

```typescript
// This is also correct - userResult is already a Result type
const userResult = await tryAsync({...});
if (userResult.error) return userResult; // Returns the full Result
```

### Examples

```typescript
// SYNCHRONOUS: JSON parsing with fallback
const { data: config } = trySync({
	try: () => JSON.parse(configString),
	catch: (e) => {
		console.log('Invalid config, using defaults');
		return Ok({ theme: 'dark', autoSave: true });
	},
});

// SYNCHRONOUS: File system check
const { data: exists } = trySync({
	try: () => fs.existsSync(path),
	catch: () => Ok(false), // Assume doesn't exist if check fails
});

// ASYNCHRONOUS: Graceful process termination
await tryAsync({
	try: async () => {
		await process.kill();
	},
	catch: (e) => {
		console.log('Process already dead, continuing...');
		return Ok(undefined);
	},
});

// ASYNCHRONOUS: File operations with fallback
const { data: content } = await tryAsync({
	try: () => readFile(path),
	catch: (e) => {
		console.log('File not found, using default');
		return Ok('default content');
	},
});

// EITHER: Error propagation (works with both)
// Pass the raw caught error as cause — the defineErrors constructor calls extractErrorMessage
const { data, error } = await tryAsync({
	try: () => criticalOperation(),
	catch: (error) =>
		CompletionError.ConnectionFailed({ cause: error }),
});
if (error) return Err(error);
```

### When to Use trySync vs tryAsync vs try-catch

- **Use trySync when**:
  - Working with synchronous operations (JSON parsing, validation, calculations)
  - You need immediate Result types without promises
  - Handling errors in synchronous utility functions
  - Working with filesystem sync operations

- **Use tryAsync when**:
  - Working with async/await operations
  - Making network requests or database calls
  - Reading/writing files asynchronously
  - Any operation that returns a Promise

- **Use traditional try-catch when**:
  - In module-level initialization code where you can't await
  - For simple fire-and-forget operations
  - When you're outside of a function context
  - When integrating with code that expects thrown exceptions
