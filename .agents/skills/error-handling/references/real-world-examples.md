# Real-World Examples from the Codebase

## When to Read This

Read when you want concrete codebase patterns for minimal wraps, multiple wraps with cleanup, and quick scenario-to-approach guidance.

### Real-World Examples from the Codebase

**Minimal wrap with immediate return:**

```typescript
// From device-stream.ts — cause: error at call site, extractErrorMessage in constructor
async function getStreamForDeviceIdentifier(
	deviceIdentifier: DeviceIdentifier,
) {
	return tryAsync({
		try: async () => {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { ...constraints, deviceId: { exact: deviceIdentifier } },
			});
			return stream;
		},
		catch: (error) =>
			DeviceStreamError.DeviceConnectionFailed({ deviceId: deviceIdentifier, cause: error }),
	});
}
```

**Multiple minimal wraps with immediate returns:**

```typescript
// From navigator.ts
startRecording: async (params, { sendStatus }) => {
  if (activeRecording) {
    return RecorderError.AlreadyRecording();
  }

  // First try block - get stream
  const { data: streamResult, error: acquireStreamError } =
    await getRecordingStream({ selectedDeviceId, sendStatus });
  if (acquireStreamError) return Err(acquireStreamError);

  const { stream, deviceOutcome } = streamResult;

  // Second try block - create recorder
  const { data: mediaRecorder, error: recorderError } = trySync({
    try: () => new MediaRecorder(stream, { bitsPerSecond: bitrate }),
    catch: (error) => RecorderError.InitFailed({ cause: error }),
  });

  if (recorderError) {
    cleanupRecordingStream(stream);  // Cleanup on failure
    return Err(recorderError);
  }

  // Happy path continues...
  mediaRecorder.start(TIMESLICE_MS);
  return Ok(deviceOutcome);
},
```

### Summary: Wrapping Guidelines

| Scenario                                     | Approach                                          |
| -------------------------------------------- | ------------------------------------------------- |
| Single risky operation                       | Wrap just that operation                          |
| Sequential operations                        | Wrap each separately, return immediately on error |
| Atomic operations that must succeed together | Wrap together in one block                        |
| Different error types needed                 | Separate blocks with appropriate error types      |
| Need cleanup on failure                      | Wrap, check error, cleanup if needed, return      |

**The goal**: Each `trySync`/`tryAsync` block should represent a single "unit of failure" with a specific, descriptive error message.
