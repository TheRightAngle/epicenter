# Advanced Query Patterns

## When to Read This

Read when implementing cache updates, defining query/mutation patterns, wiring the RPC namespace, or coordinating multi-service query-layer APIs.

## Cache Management

### Optimistic Updates Pattern

Update the cache immediately, then sync with server:

```typescript
create: defineMutation({
  mutationKey: ['db', 'recordings', 'create'] as const,
  mutationFn: async (params: { recording: Recording; audio: Blob }) => {
    const { error } = await services.db.recordings.create(params);
    if (error) return Err(error);

    // Optimistic cache updates - UI updates instantly
    queryClient.setQueryData<Recording[]>(
      dbKeys.recordings.all,
      (oldData) => [...(oldData || []), params.recording],
    );
    queryClient.setQueryData<Recording>(
      dbKeys.recordings.byId(params.recording.id),
      params.recording,
    );

    // Invalidate to refetch fresh data in background
    queryClient.invalidateQueries({ queryKey: dbKeys.recordings.all });
    queryClient.invalidateQueries({ queryKey: dbKeys.recordings.latest });

    return Ok(undefined);
  },
}),
```

### Query Keys Pattern

Organize keys hierarchically for targeted invalidation:

```typescript
export const dbKeys = {
	recordings: {
		all: ['db', 'recordings'] as const,
		latest: ['db', 'recordings', 'latest'] as const,
		byId: (id: string) => ['db', 'recordings', id] as const,
	},
	transformations: {
		all: ['db', 'transformations'] as const,
		byId: (id: string) => ['db', 'transformations', id] as const,
	},
};
```

## Query Definition Examples

### Basic Query

```typescript
export const db = {
	recordings: {
		getAll: defineQuery({
			queryKey: dbKeys.recordings.all,
			queryFn: () => services.db.recordings.getAll(),
		}),
	},
};
```

### Query with Initial Data

```typescript
getLatest: defineQuery({
  queryKey: dbKeys.recordings.latest,
  queryFn: () => services.db.recordings.getLatest(),
  // Use cached data if available
  initialData: () =>
    queryClient
      .getQueryData<Recording[]>(dbKeys.recordings.all)
      ?.toSorted((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0] ?? null,
  initialDataUpdatedAt: () =>
    queryClient.getQueryState(dbKeys.recordings.all)?.dataUpdatedAt,
}),
```

### Parameterized Query with Accessor

```typescript
getById: (id: Accessor<string>) =>
  defineQuery({
    queryKey: dbKeys.recordings.byId(id()),
    queryFn: () => services.db.recordings.getById(id()),
    initialData: () =>
      queryClient
        .getQueryData<Recording[]>(dbKeys.recordings.all)
        ?.find((r) => r.id === id()) ?? null,
  }),
```

### Mutation with Callbacks

```typescript
startRecording: defineMutation({
  mutationKey: recorderKeys.startRecording,
  mutationFn: async ({ toastId }) => {
    const { data, error } = await recorderService().startRecording(params, {
      sendStatus: (options) => notify.loading.execute({ id: toastId, ...options }),
    });

    if (error) {
      return Err({
        title: '❌ Failed to start recording',
        description: error.message,
        action: { type: 'more-details', error },
      });
    }
    return Ok(data);
  },
  // Invalidate state after mutation completes
  onSettled: () => queryClient.invalidateQueries({ queryKey: recorderKeys.recorderState }),
}),
```

## RPC Namespace

All queries are bundled into a unified `rpc` namespace:

```typescript
// query/index.ts
export const rpc = {
	db,
	recorder,
	transcription,
	clipboard,
	sound,
	analytics,
	notify,
	// ... all feature modules
} as const;

// Usage anywhere in the app
import { rpc } from '$lib/query';

// Reactive (in components)
const query = createQuery(() => rpc.db.recordings.getAll.options);

// Imperative (in handlers/workflows)
const { data, error } = await rpc.recorder.startRecording.execute({ toastId });
```

## Notify API Example

The query layer can coordinate multiple services:

```typescript
export const notify = {
	success: defineMutation({
		mutationFn: async (options: NotifyOptions) => {
			// Show both toast AND OS notification
			services.toast.success(options);
			await services.notification.show({ ...options, variant: 'success' });
			return Ok(undefined);
		},
	}),

	error: defineMutation({
		mutationFn: async (error: UserError) => {
			services.toast.error(error);
			await services.notification.show({ ...error, variant: 'error' });
			return Ok(undefined);
		},
	}),

	loading: defineMutation({
		mutationFn: async (options: LoadingOptions) => {
			// Only toast for loading states (no OS notification spam)
			services.toast.loading(options);
			return Ok(undefined);
		},
	}),
};
```
