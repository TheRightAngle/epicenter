# Wrapping Patterns: Minimal vs Extended

## When to Read This

Read when deciding how much code to wrap in `trySync`/`tryAsync`, when to use immediate-return control flow, and when combining operations in a single try block is appropriate.

## Wrapping Patterns: Minimal vs Extended

### The Minimal Wrapping Principle

**Wrap only the specific operation that can fail.** This captures the error boundary precisely and makes code easier to reason about.

```typescript
// ✅ GOOD: Wrap only the risky operation, pass raw cause to constructor
const { data: stream, error: streamError } = await tryAsync({
	try: () => navigator.mediaDevices.getUserMedia({ audio: true }),
	catch: (error) =>
		DeviceStreamError.PermissionDenied({ cause: error }),
});

if (streamError) return Err(streamError);

// Continue with non-throwing operations
const mediaRecorder = new MediaRecorder(stream);
mediaRecorder.start();
```

```typescript
// ❌ BAD: Wrapping too much code
const { data, error } = await tryAsync({
	try: async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mediaRecorder = new MediaRecorder(stream);
		mediaRecorder.start();
		await someOtherAsyncCall();
		return processResults();
	},
	catch: (error) => Err(error), // Too vague! No specific error type
});
```

### The Immediate Return Pattern

**Return errors immediately after checking.** This creates clear control flow and prevents error nesting.

```typescript
// ✅ GOOD: Check and return immediately
const { data: devices, error: enumerateError } = await enumerateDevices();
if (enumerateError) return Err(enumerateError);

const { data: stream, error: streamError } = await getStreamForDevice(
	devices[0],
);
if (streamError) return Err(streamError);

// Happy path continues cleanly
return Ok(stream);
```

```typescript
// ❌ BAD: Nested error handling
const { data: devices, error: enumerateError } = await enumerateDevices();
if (!enumerateError) {
	const { data: stream, error: streamError } = await getStreamForDevice(
		devices[0],
	);
	if (!streamError) {
		return Ok(stream);
	} else {
		return Err(streamError);
	}
} else {
	return Err(enumerateError);
}
```

### When to Extend the Try Block

Sometimes it makes sense to include multiple operations in a single try block:

1. **Atomic operations** - When operations must succeed or fail together
2. **Same error type** - When all operations produce the same error category
3. **Cleanup logic** - When you need to clean up on any failure

```typescript
// Extended block is appropriate here - all operations are part of "starting recording"
const { data: mediaRecorder, error: recorderError } = trySync({
	try: () => {
		const recorder = new MediaRecorder(stream, { bitsPerSecond: bitrate });
		recorder.addEventListener('dataavailable', handleData);
		recorder.start(TIMESLICE_MS);
		return recorder;
	},
	catch: (error) =>
		RecorderError.InitFailed({ cause: error }),
});
```
