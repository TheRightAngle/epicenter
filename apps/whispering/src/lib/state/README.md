# State

Singleton reactive state that stays in sync with the application. Unlike the query layer which uses stale-while-revalidate caching, state modules maintain live state that updates immediately and persists across the application lifecycle.

## When to Use State vs Query Layer

| Aspect | `$lib/state/` | `$lib/query/` |
|--------|----------------|---------------|
| **Pattern** | Singleton reactive state | Stale-while-revalidate (TanStack Query) |
| **State Location** | Module-level `$state` runes | TanStack Query cache |
| **Updates** | Immediate, live | Cached with background refresh |
| **Use Case** | Hardware state, user preferences, live status, workspace table data | Data fetching, mutations, external API calls |
| **Lifecycle** | Application lifetime | Managed by TanStack Query |

## Current State Modules

### `settings.svelte.ts`

Synced workspace settings backed by Yjs KV. Settings here roam across devices via CRDT sync. Uses a SvelteMap for per-key reactivity.

```typescript
import { settings } from '$lib/state/settings.svelte';

// Read settings reactively (re-renders on change)
const mode = settings.get('recording.mode');

// Update settings (writes to Yjs KV → syncs to other devices)
settings.set('recording.mode', 'vad');
```

### `recordings.svelte.ts`

Recording metadata backed by Yjs workspace table. SvelteMap provides per-key reactivity—updating one recording doesn't re-render the entire list. Audio blobs are NOT stored here (too large for CRDTs); use `DbService.recordings.getAudioBlob()` for audio access.

```typescript
import { recordings } from '$lib/state/recordings.svelte';

// Read recordings reactively
const recording = recordings.get(id);
const sorted = recordings.sorted; // newest first

// Write (Yjs observer auto-updates SvelteMap)
recordings.set(recording);
recordings.update(id, { transcriptionStatus: 'DONE' });
recordings.delete(id);
```

### `transformations.svelte.ts`

Transformation metadata backed by Yjs workspace table. Steps are stored in a separate table (`transformation-steps.svelte.ts`), not embedded in the transformation.

```typescript
import { transformations } from '$lib/state/transformations.svelte';

const transformation = transformations.get(id);
const sorted = transformations.sorted; // alphabetical
```

### `transformation-steps.svelte.ts`

Transformation steps backed by Yjs workspace table. Steps have a `transformationId` FK and `order` field.

```typescript
import { transformationSteps } from '$lib/state/transformation-steps.svelte';

// Get steps for a transformation, sorted by order
const steps = transformationSteps.getByTransformationId(transformationId);
```

### `transformation-runs.svelte.ts`

Transformation run execution records backed by Yjs workspace table.

```typescript
import { transformationRuns } from '$lib/state/transformation-runs.svelte';

const runs = transformationRuns.getByRecordingId(recordingId);
const latest = transformationRuns.getLatestByRecordingId(recordingId);
```

### `device-config.svelte.ts`

Device-bound configuration backed by per-key localStorage. Secrets, hardware IDs, filesystem paths, and global OS shortcuts that should never sync across devices. Uses a SvelteMap for per-key reactivity with cross-tab sync via storage events.

```typescript
import { deviceConfig } from '$lib/state/device-config.svelte';

// Read config reactively
const apiKey = deviceConfig.get('apiKeys.openai');

// Update config (writes to localStorage per-key)
deviceConfig.set('apiKeys.openai', 'sk-...');

// Get definition default (for "Default: X" placeholders)
const defaultShortcut = deviceConfig.getDefault('shortcuts.global.toggleManualRecording');
```

### `vad-recorder.svelte.ts`

Voice Activity Detection (VAD) recorder singleton. Manages the VAD hardware state and provides reactive access to detection status.

```typescript
import { vadRecorder } from '$lib/state/vad-recorder.svelte';

// Reactive state access (triggers $effect when changed)
$effect(() => {
  console.log('VAD state:', vadRecorder.state); // 'IDLE' | 'LISTENING' | 'SPEECH_DETECTED'
});

// Start/stop VAD
await vadRecorder.startActiveListening({
  onSpeechStart: () => console.log('Speaking...'),
  onSpeechEnd: (blob) => processAudio(blob),
});
await vadRecorder.stopActiveListening();
```

## Why VAD Lives Here

The VAD recorder doesn't fit the query layer pattern because:

1. **Live state**: VAD state (`IDLE` → `LISTENING` → `SPEECH_DETECTED`) must update immediately as hardware events occur
2. **Singleton nature**: Only one VAD instance can exist at a time
3. **Resource management**: Requires explicit cleanup (`stopActiveListening`) rather than cache invalidation
4. **Hardware lifecycle**: Tied to microphone access, not data fetching

## Adding New State Modules

Create a new state module when you need:

1. **Live reactive state** that must update immediately (not stale-while-revalidate)
2. **Singleton behavior** where only one instance should exist
3. **Application-lifetime persistence** (not request-scoped)
4. **Hardware or system state** that can't be "refreshed" like data

Use the query layer (`$lib/query/`) instead when you need:
- Data fetching with caching
- Mutations with optimistic updates
- Background refresh and stale-while-revalidate
- TanStack Query devtools integration

See `$lib/query/README.md` for the query layer documentation.
