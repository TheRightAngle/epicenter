# Query Layer

The query layer is the reactive bridge between your UI components and the isolated service layer. It adds caching, reactivity, and state management on top of pure service functions.

```typescript
import { createQueryFactories } from 'wellcrafted/query';
import { queryClient } from './client';

export const { defineQuery, defineMutation } =
	createQueryFactories(queryClient);
```

These factory functions `defineQuery` and `defineMutations` take in query options with result query functions, you get two ways to use it:

1. **`.options`** - A static object containing query/mutation options. Wrap in an accessor function for reactive use: `() => x.options`
2. **`.fetch()`/`.execute()`** - Imperative fetching/execution without subscriptions. These still go through TanStack Query's cache/mutation cache, so mutations still register and can be debugged in the devtools.

## The Dual Interface Pattern

Every operation in the query layer provides **two interfaces** to match how you want to use it:

### Reactive Interface (`.options`) - Automatic State Management

```svelte
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';

	// Reactive in components - wrap .options in accessor function
	const recorderState = createQuery(() => rpc.recorder.getRecorderState.options);
	// Syncs: recorderState.isPending, recorderState.data, recorderState.error automatically
</script>

{#if recorderState.isPending}
	<div class="spinner">Loading recorder state...</div>
{:else if recorderState.error}
	<div class="error">Error: {recorderState.error.message}</div>
{:else if recorderState.data}
	<RecorderIndicator state={recorderState.data} />
{/if}
```

**Perfect for** when you want the UI to track and synchronize with the query/mutation lifecycle. This provides automatic state management where your components react to loading states, data changes, and errors without manual intervention.

Examples:

- Component data display
- Loading states and spinners
- Automatic re-renders when data changes
- Cache synchronization across components

### Imperative Interface (`.execute()`) - Direct Execution

```typescript
// Imperative in actions - lightweight and fast
const { data, error } =
	await rpc.text.copyToClipboard.execute({ text });
// No observers, no subscriptions, just the result
```

**Perfect for** when you don't need the overhead of observers or subscriptions, and when you want to call operations outside of component lifecycle. This avoids having to create mutations first or prop-drill mutation functions down to child components. You can call `.execute()` directly from anywhere without being constrained by component boundaries.

Examples:

- Event handlers (button clicks, form submissions)
- Sequential operations and workflows
- One-time data fetches
- Performance-critical operations
- Utility functions outside components

## Runtime Dependency Injection

The query layer handles **runtime dependency injection**—dynamically switching service implementations based on user settings. Unlike services which use build-time platform detection, the query layer makes decisions based on reactive variables:

```typescript
// Simplified example inspired by the actual transcription implementation
async function transcribeBlob(blob: Blob) {
	const selectedService =
		settings.value['transcription.selectedTranscriptionService'];

	switch (selectedService) {
		case 'OpenAI':
			return services.transcriptions.openai.transcribe(blob, {
				apiKey: settings.value['apiKeys.openai'],
				model: settings.value['transcription.openai.model'],
			});
		case 'Groq':
			return services.transcriptions.groq.transcribe(blob, {
				apiKey: settings.value['apiKeys.groq'],
				model: settings.value['transcription.groq.model'],
			});
	}
}
```

## Workspace State & Reactivity

> **Historical note**: Before the workspace migration, the query layer used TanStack Query's cache for optimistic UI via `queryClient.setQueryData(['recordings'], ...)`. Domain data (recordings, transformations, transformation runs) has since moved to Yjs-backed workspace state modules (`$lib/state/*.svelte.ts`), which provide instant reactivity without cache manipulation. The query layer now focuses on non-CRUD operations: audio blob access, external API calls, hardware state, and coordination logic.

## Error Transformation Pattern

A critical responsibility of the query layer is transforming service-specific errors into `WhisperingError` types that work seamlessly with our toast notification system. This transformation happens inside `mutationFn` or `queryFn`, creating a clean boundary between business logic errors and UI presentation.

### Error Handling Architecture

The error handling follows a clear pattern across three layers:

1. **Service Layer**: Returns domain-specific errors using `defineErrors` pattern
2. **Query Layer**: Wraps service errors into `WhisperingError` objects
3. **UI Layer**: Uses `WhisperingError` directly without re-wrapping

This pattern ensures consistent error handling and avoids double-wrapping errors.

### How It Works

Services return their own specific error types (defined with `defineErrors`), which contain detailed error information. The query layer transforms these into `WhisperingError` with UI-friendly formatting:

```typescript
// From manualRecorder.ts - Error transformation in mutationFn
startRecording: defineMutation({
	mutationFn: async ({ toastId }: { toastId: string }) => {
		const { data: deviceAcquisitionOutcome, error: startRecordingError } =
			await services.recorder.startRecording(recordingSettings, {
				sendStatus: (options) =>
					notify.loading.execute({ id: toastId, ...options }),
			});

		// Transform service error to WhisperingError
		if (startRecordingError) {
			return Err(
				WhisperingError({
					title: '❌ Failed to start recording',
					description: startRecordingError.message, // Use service error message
					action: { type: 'more-details', error: startRecordingError },
				}),
			);
		}
		return Ok(deviceAcquisitionOutcome);
	},
	// WhisperingError is now available in onError hook
	onError: (error) => {
		// error is WhisperingError, ready for toast display
		notify.error.execute(error);
	},
});
```

### The Pattern Explained

1. **Service Layer**: Returns domain-specific errors using `defineErrors`

   ```typescript
   // In manual-recorder.ts
   const { RecorderError } = defineErrors({
   	RecorderError: {},
   });
   ```

2. **Query Layer**: Transforms to `WhisperingError` in `mutationFn`/`queryFn`

   ```typescript
   if (serviceError) {
   	return Err(
   		WhisperingError({
   			title: '❌ User-friendly title',
   			description: serviceError.message, // Preserve detailed message
   			action: { type: 'more-details', error: serviceError },
   		}),
   	);
   }
   ```

3. **UI Layer**: Receives `WhisperingError` in hooks, perfect for toasts
   ```typescript
   onError: (error) => notify.error.execute(error); // error is WhisperingError
   ```

### Why This Pattern?

- **Separation of Concerns**: Services focus on business logic errors, not UI presentation
- **Consistent UI**: All errors are transformed to a format that toasts understand
- **Detailed Context**: Original service errors are preserved in the `action` field
- **Type Safety**: TypeScript knows exactly what error types flow through each layer
- **No Double Wrapping**: Each error is wrapped exactly once, at the query layer

### Real Example: CPAL Recorder

```typescript
// From cpalRecorder.ts
getRecorderState: defineQuery({
	queryFn: async () => {
		const { data: recorderState, error: getRecorderStateError } =
			await services.cpalRecorder.getRecorderState();

		if (getRecorderStateError) {
			// Transform CpalRecorderError → WhisperingError
			return Err(
				WhisperingError({
					title: '❌ Failed to get recorder state',
					description: getRecorderStateError.message,
					action: { type: 'more-details', error: getRecorderStateError },
				}),
			);
		}
		return Ok(recorderState);
	},
});
```

### Anti-Patterns to Avoid

#### ❌ Double Wrapping

```typescript
// BAD: Don't wrap an already-wrapped WhisperingError
if (getRecorderStateError) {
	const whisperingError = WhisperingErr({
		title: '❌ Failed to get recorder state',
		description: getRecorderStateError.message,
		action: { type: 'more-details', error: getRecorderStateError },
	});
	notify.error.execute({ id: nanoid(), ...whisperingError.error });
	return whisperingError;
}
```

#### ❌ Inconsistent Query Layer

```typescript
// BAD: Query layer should wrap errors, not return raw service errors
getRecorderState: defineQuery({
	queryKey: recorderKeys.state,
	queryFn: () => services.recorder.getRecorderState(), // Missing error wrapping!
	initialData: 'IDLE' as WhisperingRecordingState,
});
```

#### ✅ Correct Pattern

```typescript
// GOOD: Query wraps service errors, UI uses them directly
getRecorderState: defineQuery({
	queryFn: async () => {
		const { data, error } = await services.recorder.getRecorderState();
		if (error) {
			return Err(
				WhisperingError({
					title: '❌ Failed to get recorder state',
					description: error.message,
					action: { type: 'more-details', error },
				}),
			);
		}
		return Ok(data);
	},
});

// In UI/command layer - use WhisperingError directly
if (error) {
	notify.error.execute(error); // No re-wrapping!
}
```

This pattern ensures that:

- Services remain pure and testable with their own error types
- The query layer handles all UI-specific error formatting
- Toast notifications receive properly formatted `WhisperingError` objects
- Original error context is preserved for debugging
- Errors are wrapped exactly once, avoiding redundant object creation

## Static Site Generation Advantage

This application is fully static site generated and client-side only, which gives us a unique architectural advantage: direct access to the TanStack Query client.

Unlike server-side rendered applications where the query client lifecycle is managed by frameworks, our static approach means:

- Direct Query Client Access: We can call `queryClient.fetchQuery()` and `queryClient.getMutationCache().build()` directly
- Imperative Control: No need to go through reactive hooks for one-time operations
- Performance Benefits\*\*: We can build mutations using direct execution rather than creating unnecessary subscribers
- Flexible Interfaces: Both reactive (`.options`) and imperative (`.execute()`, `.fetch()`) patterns work seamlessly

This enables our unique dual interface pattern where every query and mutation provides both reactive and imperative APIs.

## What is RPC?

**RPC** (Result Procedure Call) is our central namespace that bundles all query operations into one unified interface. Think of it as your app's "API client" that lives in the frontend:

```typescript
import { rpc } from '$lib/query';

// Everything you can do in the app is available through rpc.*
rpc.audio.getPlaybackUrl;
rpc.transcription.transcribeRecording;
rpc.text.copyToClipboard;
// ... and much more
```

### The Notify API - Query Layer Coordination

The `notify` API demonstrates how the query layer coordinates multiple services:

```typescript
import { notify } from '$lib/query';

// Shows BOTH a toast (in-app) AND OS notification
await notify.success.execute({
	title: 'Recording saved',
	description: 'Your recording has been transcribed',
});

// Loading states only show toasts (no OS notification spam)
const loadingId = await notify.loading.execute({
	title: 'Processing...',
});
notify.dismiss(loadingId);
```

This showcases the query layer's coordination role:

- Calls the `toast` service for in-app notifications
- Calls the `notifications` service for OS-level alerts
- Adds intelligent logic (e.g., skipping OS notifications for loading states)
- Provides a unified API that's easier to use than calling services directly

The name "RPC" is inspired by Remote Procedure Calls, but adapted for our needs:

- **R**esult: Every operation returns a `Result<T, E>` type for consistent error handling
- **P**rocedure: Each operation is a well-defined procedure (query or mutation)
- **C**all: You can call these procedures reactively or imperatively

> **Author's Note**: I know, I know... "RPC" traditionally stands for "Remote Procedure Call," but I've reused the acronym to mean because it's fun and technically this builds off the Result type. People are already familiar with the RPC mental model, and honestly it just feels good to write `rpc`. Plus, it sounds way cooler than "query namespace" or whatever. 🤷‍♂️

## The .execute() Performance Advantage

When you call `createMutation()`, you're creating a _mutation observer_ that subscribes to reactive state changes. If you don't need the reactive state (like `isPending`, `isError`, etc.), you're paying a performance cost for functionality you're not using.

### Performance Comparison

```typescript
// ❌ createMutation() approach - Creates subscriber
const mutation = createMutation(rpc.recorder.startRecording.options);
// This creates a mutation observer that:
// - Subscribes to state changes
// - Triggers component re-renders
// - Manages reactive state (isPending, isError, etc.)
// - Adds memory overhead

// Then you call it with callbacks:
mutation.mutate(
	{ toastId },
	{
		onSuccess: () => {
			/* ... */
		},
		onError: (error) => {
			/* ... */
		},
	},
);
```

```typescript
// ✅ .execute() approach - Direct execution
const { data, error } = await rpc.recorder.startRecording.execute({ toastId });
// This directly:
// - Executes the mutation immediately
// - Returns a simple Result<T, E>
// - No reactive state management
// - No component subscriptions
// - No memory overhead from observers
```

### When to Use Each Approach

**Use `.execute()` when:**

- Event handlers that just need the result
- Sequential operations in commands/workflows
- You don't need reactive state (isPending, etc.)
- Performance is critical
- Non-component code (services, utilities)

**Use `createMutation()` when:**

- You need reactive state for UI feedback
- Loading spinners, disable states, error displays
- The component needs to react to mutation state changes

## Why RPC?

Instead of importing individual queries from different files:

```typescript
// ❌ Without RPC (scattered imports)
import { getPlaybackUrl } from '$lib/query/audio';
import { transcribeRecording } from '$lib/query/transcription';
import { copyToClipboard } from '$lib/query/text';
```

You get everything through one clean namespace:

```typescript
// ✅ With RPC (unified interface)
import { rpc } from '$lib/query';

// Now you have intellisense for everything!
rpc.audio.getPlaybackUrl;
rpc.transcription.transcribeRecording;
rpc.text.copyToClipboard;
```

RPC provides:

- Unified Import: One import gives you access to everything
- Better DX: IntelliSense shows all available operations organized by domain
- Consistent Interface: Every operation follows the same dual-interface pattern
- Discoverability: Easy to explore what operations are available

## Architecture Philosophy

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│     UI      │ --> │  RPC/Query  │ --> │   Services   │
│ Components  │     │    Layer    │     │    (Pure)    │
└─────────────┘     └─────────────┘     └──────────────┘
      ↑                    │
      └────────────────────┘
         Reactive Updates
```

### How It Works

1. **Services**: Pure functions that return `Result<T, E>` (never throw)
2. **Query Layer**: Uses WellCrafted's factories to wrap service functions
3. **RPC Namespace**: Bundles all queries into one global object for easy access
4. **UI Components**: Choose reactive (`.options`) or imperative (`.execute()`) based on needs

## Real-World RPC Usage Throughout the App

### 1. Reactive Queries in Components

```svelte
<!-- From: /routes/+page.svelte -->
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';

	// These queries automatically update when data changes
	const recorderState = createQuery(
		rpc.recorder.getRecorderState.options,
	);
	const devices = createQuery(
		rpc.recorder.enumerateDevices.options,
	);
</script>

{#if $recorderState.data === 'RECORDING'}
	<RecordingIndicator />
{/if}

{#if $devices.data}
	{#each $devices.data as device}
		<DeviceOption {device} />
	{/each}
{/if}
```

### 2. Imperative Mutations with Error Handling

```typescript
// From: /lib/query/delivery.ts
// ✅ Direct execution - no reactive overhead
async function copyToClipboard(text: string) {
	const { error } = await rpc.text.copyToClipboard.execute({ text });

	if (error) {
		// Using the notify API to show both toast and OS notification
		await notify.error.execute({
			title: 'Error copying to clipboard',
			description: error.message,
			action: { type: 'more-details', error },
		});
	}
}

// ❌ Alternative with createMutation (unnecessary overhead)
// const copyMutation = createMutation(() => rpc.text.copyToClipboard.options);
// copyMutation.mutate({ text }); // Creates observer, manages state we don't need
```

### 3. Sequential Operations - The .execute() Sweet Spot

```typescript
// From: /lib/query/actions.ts
// ✅ Perfect use case for .execute() - sequential workflow without UI reactivity
async function processRecordingPipeline({ blob, toastId }: { blob: Blob; toastId: string }) {
	// Step 1: Transcribe the audio blob
	const { data: transcribedText, error: transcribeError } =
		await rpc.transcription.transcribeRecording.execute(recording);

	if (transcribeError) {
		notify.error.execute({ id: toastId, ...transcribeError });
		return;
	}

	// Step 2: Play sound effect (fire-and-forget)
	rpc.sound.playSoundIfEnabled.execute('transcriptionComplete');

	// Step 3: Deliver transcription to user (clipboard + cursor)
	await rpc.delivery.deliverTranscriptionResult.execute({
		text: transcribedText,
		toastId,
	});

	// Step 4: Optionally run transformation
	const { data: transformationRun, error: transformError } =
		await rpc.transformer.transformRecording.execute({
			recordingId: recording.id,
			transformation,
		});

	if (transformError) return;

	// Step 5: Deliver transformation result
	await rpc.delivery.deliverTransformationResult.execute({
		text: transformationRun.output,
		toastId,
	});
}

// ❌ With createMutation (overkill for workflows)
// const transcribeMutation = createMutation(() => rpc.transcription.transcribeRecording.options);
// const deliverMutation = createMutation(() => rpc.delivery.deliverTranscriptionResult.options);
// Multiple observers created, state managed unnecessarily
```

### 4. Dynamic Queries with Parameters

```typescript
// From: /routes/(config)/settings/recording/SelectRecordingDevice.svelte
// Enumerate available recording devices
const devices = createQuery(rpc.recorder.enumerateDevices.options);
```

### 5. Options Factory Pattern for Conditional Queries

```typescript
// From: /routes/+layout/alwaysOnTop.svelte.ts
const recorderStateQuery = createQuery(() => ({
	...rpc.recorder.getRecorderState.options,
	// Only enable this query when in manual recording mode
	enabled: settings.value['recording.mode'] === 'manual',
}));
```

### 6. Direct Function Calls (Synchronous Operations)

```typescript
// Some RPC methods are direct functions, not queries/mutations
if (rpc.transcription.isCurrentlyTranscribing()) {
	showTranscribingIndicator();
}
```

### 7. Batch Mutations in UI

```svelte
<!-- From: /routes/(config)/recordings/+page.svelte -->
<script lang="ts">
	// Create mutations with just .options (no parentheses!)
	const transcribeRecordings = createMutation(
		rpc.transcription.transcribeRecordings.options,
	);
	const downloadRecording = createMutation(
		rpc.download.downloadRecording.options,
	);

	async function handleBulkAction(
		selectedIds: string[],
		recordings: Recording[],
	) {
		if (action === 'transcribe') {
			transcribeRecordings.mutate(recordings, {
				onSuccess: ({ oks, errs }) => {
					if (errs.length === 0) {
						toast.success(`Transcribed ${oks.length} recordings!`);
					} else {
						toast.warning(
							`Transcribed ${oks.length} of ${recordings.length} recordings`,
						);
					}
				},
				onError: (error) => {
					toast.error('Failed to transcribe recordings', {
						description: error.message,
					});
				},
			});
		} else if (action === 'download') {
			for (const recording of recordings) {
				downloadRecording.mutate(recording, {
					onSuccess: () => {
						toast.success(`Downloaded recording ${recording.id}`);
					},
					onError: (error) => {
						toast.error('Failed to download recording', {
							description: error.message,
						});
					},
				});
			}
		}
	}
</script>
```

## Getting Started

The easiest way to understand the query layer is to see it in action:

```svelte
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';

	// This automatically subscribes to recorder state changes
	const recorderState = createQuery(() => rpc.recorder.getRecorderState.options);
</script>

{#if recorderState.isPending}
	<p>Loading...</p>
{:else if recorderState.error}
	<p>Error: {recorderState.error.message}</p>
{:else if recorderState.data}
	<RecorderIndicator state={recorderState.data} />
{/if}
```

Or imperatively in an event handler:

```typescript
async function handleCopy(text: string) {
	const { error } = await rpc.text.copyToClipboard.execute({ text });
	if (error) {
		notify.error.execute({
			title: 'Failed to copy',
			description: error.message,
		});
	}
}
```

WellCrafted handles the `Result<T, E>` unwrapping, so TanStack Query gets regular values/errors while you keep type safety.

## Core Utilities from WellCrafted

### `defineQuery` and `defineMutation`

These factory functions (`defineQuery` and `defineMutation`) take query options with result functions - functions that return `Result<T, E>`. From there, you get two ways to use it:

- `.options` - Static object with query/mutation options (wrap in accessor: `() => x.options`)
- `.fetch()` / `.execute()` - Direct execution methods

**`defineQuery`** - For data fetching:

```typescript
// Your service returns Result<T, E>
const userQuery = defineQuery({
	queryKey: ['users', userId],
	queryFn: () => services.getUser(userId), // Returns Result<User, ApiError>
});

// ✅ Reactive interface - creates query observer
const query = createQuery(() => userQuery.options);
// - Subscribes to state changes
// - Manages loading, error, success states
// - Triggers component re-renders

// ✅ Imperative interface - direct query client usage
const { data, error } = await userQuery.fetch();
// - Calls queryClient.fetchQuery() directly
// - Returns cached data if fresh
// - No reactive overhead
```

**`defineMutation`** - For data modifications:

```typescript
const startRecording = defineMutation({
	mutationKey: ['recorder', 'startRecording'],
	mutationFn: async ({ toastId }: { toastId: string }) => {
		const { data, error } = await recorderService().startRecording(params, {
			sendStatus: (options) => notify.loading({ id: toastId, ...options }),
		});
		if (error) return WhisperingErr({ title: '❌ Failed to start recording', serviceError: error });
		return Ok(data);
	},
	onSettled: invalidateRecorderState,
});

// ✅ Reactive interface - creates mutation observer
const mutation = createMutation(() => startRecording.options);
// - Subscribes to mutation state (isPending, isError, etc.)
// - Triggers component re-renders on state changes
// - Useful for loading states and error displays

// ✅ Imperative interface - direct execution
const { error } = await startRecording.execute({ toastId });
// - Uses queryClient.getMutationCache().build() directly
// - Returns simple Result<T, E>
// - No reactive state management
// - Still goes through mutation cache for debugging
```

## Common Patterns

### 1. Basic Query Definition

```typescript
export const recorder = {
	getRecorderState: defineQuery({
		queryKey: recorderKeys.recorderState,
		queryFn: async () => {
			const { data, error } = await recorderService().getRecorderState();
			if (error) return WhisperingErr({ title: '❌ Failed to get recorder state', serviceError: error });
			return Ok(data);
		},
		initialData: 'IDLE' as WhisperingRecordingState,
	}),
};
```

### 2. Parameterized Queries

```typescript
getPlaybackUrl: (id: Accessor<string>) =>
  defineQuery({
    queryKey: audioKeys.playbackUrl(id()), // Dynamic key based on ID
    queryFn: () => services.db.recordings.ensureAudioPlaybackUrl(id()),
  }),
```

### 3. Mutations with Error Handling

```typescript
transcribeRecording: defineMutation({
  mutationKey: transcriptionKeys.isTranscribing,
  mutationFn: async (recording: Recording) => {
    const { data: audioBlob, error: getAudioBlobError } =
      await services.db.recordings.getAudioBlob(recording.id);

    if (getAudioBlobError) {
      return WhisperingErr({
        title: '⚠️ Failed to fetch audio',
        description: `Unable to load audio for recording: ${getAudioBlobError.message}`,
      });
    }

    recordings.update(recording.id, { transcriptionStatus: 'TRANSCRIBING' });
    const { data: transcribedText, error: transcribeError } =
      await transcribeBlob(audioBlob);

    if (transcribeError) {
      recordings.update(recording.id, { transcriptionStatus: 'FAILED' });
      return Err(transcribeError);
    }

    recordings.update(recording.id, {
      transcribedText,
      transcriptionStatus: 'DONE',
    });
    return Ok(transcribedText);
  },
}),
```

### 4. Settings-Dependent Operations

```typescript
// Transcription uses current settings dynamically
function transcribeBlob(blob: Blob) {
	return services.transcription().transcribe(blob, {
		outputLanguage: settings.value['transcription.outputLanguage'],
		prompt: settings.value['transcription.prompt'],
		temperature: settings.value['transcription.temperature'],
	});
}
```

### 5. Multi-Step Operations

```typescript
transformInput: defineMutation({
  mutationFn: async ({ input, transformation, steps }) => {
    // Step 1: Run transformation pipeline
    const { data: transformationRun, error: transformationRunError } =
      await runTransformation({ input, transformation, steps, recordingId: null });

    if (transformationRunError)
      return WhisperingErr({ title: '⚠️ Transformation failed', serviceError: transformationRunError });

    // Step 2: Check result
    if (transformationRun.status === 'failed') {
      return WhisperingErr({
        title: '⚠️ Transformation failed',
        description: transformationRun.error,
        action: { type: 'more-details', error: transformationRun.error },
      });
    }

    // Step 3: Return output
    if (!transformationRun.output) {
      return WhisperingErr({
        title: '⚠️ Transformation produced no output',
        description: 'The transformation completed but produced no output.',
      });
    }

    return Ok(transformationRun.output);
  },
}),
```

## Usage in Components

### Reactive Usage (Recommended for UI)

```svelte
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';

	// This automatically subscribes to recorder state updates
	const recorderState = createQuery(() => rpc.recorder.getRecorderState.options);
</script>

{#if recorderState.isPending}
	<p>Loading...</p>
{:else if recorderState.error}
	<p>Error: {recorderState.error.message}</p>
{:else}
	<RecorderIndicator state={recorderState.data} />
{/if}
```

### Imperative Usage (For Actions)

```typescript
async function handleDownload(recording: Recording) {
	const { error } = await rpc.download.downloadRecording.execute(recording);

	if (error) {
		toast.error({
			title: 'Failed to download',
			description: error.message,
		});
	}
}
```

## File Organization

- `_utils.ts` - Core factory functions
- `index.ts` - Query client setup and unified `rpc` export
- Feature-specific files (e.g., `transcription.ts`, `recorder.ts`, `transformer.ts`)

Each feature file typically exports an object with:

- Query definitions
- Mutation definitions
- Helper functions
- Utility methods

## Actions: Always Return Ok

Actions in the query layer always return `Ok` after handling errors. They notify the user and return success because the action itself executed—error handling is part of that execution.

```typescript
const startManualRecording = defineMutation({
	mutationFn: async () => {
		const { error } = await recorder.startRecording.execute();
		if (error) {
			notify.error.execute(error); // Notify user
			return Ok(undefined); // Action succeeded
		}
		notify.success.execute({ title: 'Recording started' });
		return Ok(undefined);
	},
});
```

Actions are UI-boundary mutations invoked from anywhere: command registry (`/lib/commands.ts`), components, state modules, etc. Since they're the end of the operation chain, errors flow sideways through notifications rather than up the call stack.

## Best Practices

1. Always use Result types - Never throw errors in query/mutation functions
2. **Mutation Pattern Preference**:
   - **In `.svelte` files**: Always prefer `createMutation` unless you have a specific reason not to (e.g., you don't need pending states)
   - **In `.ts` files**: Always use `.execute()` since createMutation requires component context
   - This gives you consistent loading states, error handling, and better UX in components
3. **Mutation callback pattern**: When using `createMutation`, pass callbacks as the second argument to `.mutate()` for maximum context
4. Choose the right interface for the job:
   - Use `.execute()` in `.ts` files and when you don't need pending state
   - Use `createMutation()` when you need reactive state for UI feedback
5. Keep queries simple - Complex logic belongs in services or orchestration mutations
6. Use proper query keys - Hierarchical and consistent
7. Leverage direct client access - Our static architecture enables powerful patterns unavailable in SSR apps

## Quick Reference: Common RPC Patterns

### Basic Query (Reactive)

```typescript
// In component
const recorderState = createQuery(rpc.recorder.getRecorderState.options);

// In template
{#if recorderState.isPending}Loading...{/if}
{#if recorderState.data}<RecorderIndicator state={recorderState.data} />{/if}
```

### Query with Parameters

```typescript
// Define with accessor
const recordingId = () => '123';
const audioUrl = createQuery(
	rpc.audio.getPlaybackUrl(recordingId).options,
);
```

### Basic Mutation (Reactive)

```typescript
// Create mutation with just .options (no parentheses!)
const downloadMutation = createMutation(
	rpc.download.downloadRecording.options,
);

// Trigger mutation with callbacks as second argument
downloadMutation.mutate(recording, {
	onSuccess: () => {
		toast.success('Recording downloaded');
		// Navigate away, close modal, etc.
	},
	onError: (error) => {
		toast.error(error.title, { description: error.description });
	},
});
```

### Imperative Execute - Performance Optimized

```typescript
// ✅ Queries - uses queryClient.fetchQuery() directly
const { data, error } = await rpc.recorder.getRecorderState.fetch();
// - Returns cached data if fresh
// - No reactive subscription
// - Perfect for prefetching or one-time fetches

// ✅ Mutations - uses queryClient.getMutationCache().build() directly
const { data, error } = await rpc.text.copyToClipboard.execute({ text });
// - Direct execution without mutation observer
// - No reactive state management overhead
// - Ideal for event handlers and workflows
```

### Error Handling Pattern

```typescript
const { data, error } = await rpc.text.copyToClipboard.execute({ text });
if (error) {
	toast.error({
		title: 'Failed to copy',
		description: error.message,
	});
	return;
}
// Success path continues...
```

### Conditional Queries

```typescript
const recorderStateQuery = createQuery(() => ({
	...rpc.recorder.getRecorderState.options,
	enabled: settings.value['recording.mode'] === 'manual',
}));
```

### Settings-Dependent Operations

```typescript
// Query layer automatically uses current settings
function transcribeBlob(blob: Blob) {
	return services.transcription().transcribe(blob, {
		outputLanguage: settings.value['transcription.outputLanguage'],
		temperature: settings.value['transcription.temperature'],
	});
}
```

## The Three Layers Explained

Understanding how RPC fits into the bigger picture:

### 1. Services Layer (`/lib/services/`)

Pure functions that do the actual work:

```typescript
// services/db.ts — still used for audio blobs and run lifecycle
export async function ensureAudioPlaybackUrl(
	recordingId: string,
): Promise<Result<string, DbError>> {
	// ...
}
```

### 2. Workspace State (`/lib/state/workspace-*.svelte.ts`)

Reactive SvelteMap modules backed by Yjs CRDTs. These replaced TanStack Query for all domain data CRUD:

```typescript
// Workspace state is the primary data layer for recordings, transformations, runs
import { recordings } from '$lib/state/recordings.svelte';

// Direct reactive access — no queries needed
const recording = recordings.get(id);
const allRecordings = recordings.sorted;
```

### 3. Query Layer (`/lib/query/`)

Wraps services with reactivity and caching for things that don't fit in workspace state:

```typescript
// query/audio.ts — audio blobs are too large for Yjs CRDTs
export const audio = {
	getPlaybackUrl: (id: Accessor<string>) =>
		defineQuery({
			queryKey: audioKeys.playbackUrl(id()),
			queryFn: () => services.db.recordings.ensureAudioPlaybackUrl(id()),
		}),
};
```

### 4. RPC Namespace (`/lib/query/index.ts`)

Bundles everything for easy access:

```typescript
// query/index.ts
export const rpc = {
	audio, // Audio blob access (too large for CRDTs)
	transcription, // External API calls
	transformer, // LLM completion orchestration
	recorder, // Hardware state management
	// ... other non-CRUD feature modules
};
```

### 5. Component Usage

Use workspace state for data, RPC for everything else:

```svelte
<script>
	import { rpc } from '$lib/query';
	import { recordings } from '$lib/state/recordings.svelte';

	// Domain data — workspace state (reactive, no queries needed)
	const latestRecording = $derived(recordings.sorted[0]);

	// Audio blob — still needs TanStack Query
	const audioUrl = createQuery(() => ({
		...rpc.audio.getPlaybackUrl(() => latestRecording?.id ?? '').options,
		enabled: !!latestRecording?.id,
	}));
</script>
```

## Adding New Features

When you need to add new functionality:

1. **Create a service** in `/services` with pure business logic
2. **Create a query wrapper** in `/query` that adds:
   - TanStack Query integration
   - Cache management
   - Settings reactivity
   - Error handling
3. **Export from RPC** in `index.ts` so it's available globally
4. **Use in components** via either reactive or imperative patterns

This keeps everything organized and testable while giving you a unified way to access all app functionality.

## Query Layer vs State

After migrating recordings, transformations, and transformation runs to Yjs workspace state modules (`$lib/state/*.svelte.ts`), the query layer's role has narrowed. Workspace state modules now handle all CRUD operations for domain data—TanStack Query is reserved for things that don't fit in CRDTs.

The query layer follows the **stale-while-revalidate** pattern: data is cached and refreshed in the background. For **live reactive state** that must update immediately (like hardware state or user preferences), use `$lib/state/` instead.

| Aspect             | `$lib/query/`                           | `$lib/state/`                                |
| ------------------ | --------------------------------------- | --------------------------------------------- |
| **Pattern**        | Stale-while-revalidate (TanStack Query) | Singleton reactive state                      |
| **State Location** | TanStack Query cache                    | Module-level `$state` runes / Yjs docs        |
| **Updates**        | Cached with background refresh          | Immediate, live                               |
| **Use Case**       | External APIs, hardware state, audio blob access | Domain data (CRUD), user preferences, live status |

**What lives where:**

- External APIs (transcription, LLM completions) → Query layer (`rpc.transcription.*`, `rpc.transformer.*`)
- Hardware state (recorder, microphone devices) → Query layer (`rpc.recorder.*`)
- Audio blob access (too large for Yjs CRDTs) → Query layer (`rpc.audio.getPlaybackUrl`)
- Recordings, transformations, transformation runs → Workspace state (`recordings`, `transformations`, etc.)
- User settings → State (`settings.value`)
- VAD hardware state → State (`vadRecorder.state`)

See `$lib/state/README.md` for the state documentation.
