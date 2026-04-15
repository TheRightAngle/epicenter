# Error Transformation Patterns

## When to Read This

Read when you need concrete examples of query-layer error transformation or want to avoid double-wrapping errors.

### Real-World Examples

```typescript
// Simple error transformation
enumerateDevices: defineQuery({
  queryKey: recorderKeys.devices,
  queryFn: async () => {
    const { data, error } = await recorderService().enumerateDevices();
    if (error) {
      return Err({
        title: '❌ Failed to enumerate devices',
        description: error.message,
        action: { type: 'more-details', error },
      });
    }
    return Ok(data);
  },
}),

// Custom description when service message isn't enough
stopRecording: defineMutation({
  mutationFn: async ({ toastId }) => {
    const { data: blob, error } = await recorderService().stopRecording({ sendStatus });

    if (error) {
      return Err({
        title: '❌ Failed to stop recording',
        description: error.message,
        action: { type: 'more-details', error },
      });
    }

    if (!recordingId) {
      return Err({
        title: '❌ Missing recording ID',
        description: 'An internal error occurred: recording ID was not set.',
      });
    }

    return Ok({ blob, recordingId });
  },
}),
```

### Anti-Pattern: Double Wrapping

Never wrap an already-wrapped error:

```typescript
// ❌ BAD: Double wrapping
if (error) {
  const userError = Err({ title: 'Failed', description: error.message });
  notify.error.execute({ id: nanoid(), ...userError.error });  // Don't spread!
  return userError;
}

// ✅ GOOD: Transform once, use directly
if (error) {
  return Err({
    title: '❌ Failed to start recording',
    description: error.message,
  });
}
// In onError hook, error is already the user-facing type
onError: (error) => notify.error.execute(error),
```
