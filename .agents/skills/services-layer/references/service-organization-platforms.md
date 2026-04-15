# Service Organization and Platform Variants

## When to Read This

Read when organizing service exports, designing namespace-based index files, or implementing platform-specific service variants (desktop vs web).

## Namespace Exports Pattern

Services are organized hierarchically and re-exported as namespace objects:

### Folder Structure

```
services/
├── desktop/           # Desktop-only (Tauri)
│   ├── index.ts       # Re-exports as desktopServices
│   ├── command.ts
│   └── ffmpeg.ts
├── isomorphic/        # Cross-platform
│   ├── index.ts       # Re-exports as services
│   ├── transcription/
│   │   ├── index.ts   # Re-exports as transcriptions namespace
│   │   ├── cloud/
│   │   │   ├── openai.ts
│   │   │   └── groq.ts
│   │   └── local/
│   │       └── whispercpp.ts
│   └── completion/
│       ├── index.ts
│       └── openai.ts
├── types.ts
└── index.ts           # Main entry point
```

### Index File Pattern

```typescript
// services/isomorphic/transcription/index.ts
export { OpenaiTranscriptionServiceLive as openai } from './cloud/openai';
export { GroqTranscriptionServiceLive as groq } from './cloud/groq';
export { WhispercppTranscriptionServiceLive as whispercpp } from './local/whispercpp';

// services/isomorphic/index.ts
import * as transcriptions from './transcription';
import * as completions from './completion';

export const services = {
	db: DbServiceLive,
	sound: PlaySoundServiceLive,
	transcriptions, // Namespace import
	completions, // Namespace import
} as const;

// services/index.ts (main entry)
export { services } from './isomorphic';
export { desktopServices } from './desktop';
```

### Consuming Services

```typescript
// In query layer or anywhere
import { services, desktopServices } from '$lib/services';

// Access via namespace
await services.transcriptions.openai.transcribe(blob, options);
await services.transcriptions.groq.transcribe(blob, options);
await services.db.recordings.getAll();
await desktopServices.ffmpeg.compressAudioBlob(blob, options);
```

## Platform-Specific Services

For services that need different implementations per platform:

### Define Shared Interface

```typescript
// services/isomorphic/text/types.ts
export type TextService = {
	readFromClipboard(): Promise<Result<string | null, TextError>>;
	copyToClipboard(text: string): Promise<Result<void, TextError>>;
	writeToCursor(text: string): Promise<Result<void, TextError>>;
};
```

### Implement Per Platform

```typescript
// services/isomorphic/text/desktop.ts
const TextError = defineErrors({
  ClipboardWriteFailed: ({ cause }: { cause: unknown }) => ({
    message: `Clipboard write failed: ${extractErrorMessage(cause)}`,
    cause,
  }),
});

export function createTextServiceDesktop(): TextService {
	return {
		copyToClipboard: (text) =>
			tryAsync({
				try: () => writeText(text), // Tauri API
				catch: (error) =>
					TextError.ClipboardWriteFailed({ cause: error }),
			}),
	};
}

// services/isomorphic/text/web.ts
export function createTextServiceWeb(): TextService {
	return {
		copyToClipboard: (text) =>
			tryAsync({
				try: () => navigator.clipboard.writeText(text), // Browser API
				catch: (error) =>
					TextError.ClipboardWriteFailed({ cause: error }),
			}),
	};
}
```

### Build-Time Platform Detection

```typescript
// services/isomorphic/text/index.ts
export const TextServiceLive = window.__TAURI_INTERNALS__
	? createTextServiceDesktop()
	: createTextServiceWeb();
```
