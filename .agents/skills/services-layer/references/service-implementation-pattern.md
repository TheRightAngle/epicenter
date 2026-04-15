# Service Implementation Pattern

## When to Read This

Read when creating or refactoring a service implementation, especially around factory functions, `Live` exports, and `Result`-based flows with `trySync`/`tryAsync`.

## Service Implementation Pattern

### Basic Service Structure

```typescript
import { defineErrors, type InferErrors, extractErrorMessage } from 'wellcrafted/error';
import { Err, Ok, type Result, tryAsync, trySync } from 'wellcrafted/result';

// 1. Define domain-specific errors — variant names describe failure modes
const AutostartError = defineErrors({
  CheckFailed: ({ cause }: { cause: unknown }) => ({
    message: `Failed to check autostart: ${extractErrorMessage(cause)}`,
    cause,
  }),
  EnableFailed: ({ cause }: { cause: unknown }) => ({
    message: `Failed to enable autostart: ${extractErrorMessage(cause)}`,
    cause,
  }),
  DisableFailed: ({ cause }: { cause: unknown }) => ({
    message: `Failed to disable autostart: ${extractErrorMessage(cause)}`,
    cause,
  }),
});
type AutostartError = InferErrors<typeof AutostartError>;

// 2. Create factory function that returns service object
export function createAutostartService() {
	return {
		async isEnabled(): Promise<Result<boolean, AutostartError>> {
			return tryAsync({
				try: () => isEnabled(),
				catch: (error) =>
					AutostartError.CheckFailed({ cause: error }),
			});
		},
		async enable(): Promise<Result<void, AutostartError>> {
			return tryAsync({
				try: () => enable(),
				catch: (error) =>
					AutostartError.EnableFailed({ cause: error }),
			});
		},
	};
}

// 3. Export the "Live" instance (production singleton)
export type AutostartService = ReturnType<typeof createAutostartService>;
export const AutostartServiceLive = createAutostartService();
```

### Real-World Example: Recorder Service

```typescript
// From apps/whispering/src/lib/services/isomorphic/recorder/navigator.ts

const RecorderError = defineErrors({
  AlreadyRecording: () => ({
    message: 'A recording is already in progress. Please stop the current recording.',
  }),
  StreamAcquisition: ({ cause }: { cause: unknown }) => ({
    message: `Failed to acquire recording stream: ${extractErrorMessage(cause)}`,
    cause,
  }),
  InitFailed: ({ cause }: { cause: unknown }) => ({
    message: `Failed to initialize recorder. ${extractErrorMessage(cause)}`,
    cause,
  }),
});
type RecorderError = InferErrors<typeof RecorderError>;

export function createNavigatorRecorderService(): RecorderService {
	let activeRecording: ActiveRecording | null = null;

	return {
		getRecorderState: async (): Promise<
			Result<WhisperingRecordingState, RecorderError>
		> => {
			return Ok(activeRecording ? 'RECORDING' : 'IDLE');
		},

		startRecording: async (
			params: NavigatorRecordingParams,
			{ sendStatus },
		): Promise<Result<DeviceAcquisitionOutcome, RecorderError>> => {
			// Validate state
			if (activeRecording) {
				return RecorderError.AlreadyRecording();
			}

			// Get stream (calls another service)
			const { data: streamResult, error: acquireStreamError } =
				await getRecordingStream({ selectedDeviceId, sendStatus });

			if (acquireStreamError) {
				return RecorderError.StreamAcquisition({
					cause: acquireStreamError,
				});
			}

			// Initialize MediaRecorder
			const { data: mediaRecorder, error: recorderError } = trySync({
				try: () =>
					new MediaRecorder(stream, {
						bitsPerSecond: Number(bitrateKbps) * 1000,
					}),
				catch: (error) =>
					RecorderError.InitFailed({ cause: error }),
			});

			if (recorderError) {
				cleanupRecordingStream(stream);
				return Err(recorderError);
			}

			// Store state and start
			activeRecording = {
				recordingId,
				stream,
				mediaRecorder,
				recordedChunks: [],
			};
			mediaRecorder.start(TIMESLICE_MS);

			return Ok(deviceOutcome);
		},
	};
}

export const NavigatorRecorderServiceLive = createNavigatorRecorderService();
```
