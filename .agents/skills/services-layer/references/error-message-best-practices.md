# Error Message Best Practices

## When to Read This

Read when authoring `defineErrors` messages and choosing between static, field-based, or split variants for clear user-facing and debugging context.

## Error Message Best Practices

Write error messages that are:

- **User-friendly**: Explain what happened in plain language
- **Actionable**: Suggest what the user can do
- **Detailed**: Include technical details for debugging

### Choosing the right approach

- **No-input variants** for static messages (e.g., `Busy: () => ({ message: '...' })`)
- **Field-based variants** when the message is computed from structured input
- **Separate variants** when different error conditions need different fields (see Anti-Pattern section above)

```typescript
const RecorderError = defineErrors({
  // Static message — no input needed
  Busy: () => ({
    message: 'A recording is already in progress',
  }),

  // Message computed from fields
  HttpResponse: ({ status }: { status: number }) => ({
    message: `HTTP ${status} response`,
    status,
  }),

  // Wrapping an unknown cause with context
  MicrophoneUnavailable: ({ cause }: { cause: unknown }) => ({
    message: `Unable to connect to the selected microphone: ${extractErrorMessage(cause)}`,
    cause,
  }),

  // User-actionable message with file context
  ConfigParseFailed: ({ filename, cause }: { filename: string; cause: unknown }) => ({
    message: `Failed to parse configuration file. Please check that ${filename} contains valid JSON. ${extractErrorMessage(cause)}`,
    filename,
    cause,
  }),
});
```
