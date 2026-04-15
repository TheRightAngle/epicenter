# Runtime Dependency Injection

## When to Read This

Read when implementing dynamic service selection based on platform or user settings.

## Runtime Dependency Injection

The query layer dynamically selects service implementations based on user settings.

### Service Selection Pattern

```typescript
// From transcription.ts - Switch between providers
async function transcribeBlob(blob: Blob): Promise<Result<string, UserError>> {
	const selectedService =
		settings.value['transcription.selectedTranscriptionService'];

	switch (selectedService) {
		case 'OpenAI':
			return await services.transcriptions.openai.transcribe(blob, {
				apiKey: settings.value['apiKeys.openai'],
				modelName: settings.value['transcription.openai.model'],
				outputLanguage: settings.value['transcription.outputLanguage'],
				prompt: settings.value['transcription.prompt'],
				temperature: settings.value['transcription.temperature'],
			});
		case 'Groq':
			return await services.transcriptions.groq.transcribe(blob, {
				apiKey: settings.value['apiKeys.groq'],
				modelName: settings.value['transcription.groq.model'],
				outputLanguage: settings.value['transcription.outputLanguage'],
				prompt: settings.value['transcription.prompt'],
				temperature: settings.value['transcription.temperature'],
			});
		// ... more cases
		default:
			return Err({
				title: '⚠️ No transcription service selected',
				description: 'Please select a transcription service in settings.',
			});
	}
}
```

### Recorder Service Selection

```typescript
// Platform + settings-based selection
export function recorderService() {
	// In browser, always use navigator recorder
	if (!window.__TAURI_INTERNALS__) return services.navigatorRecorder;

	// On desktop, use settings
	const recorderMap = {
		navigator: services.navigatorRecorder,
		ffmpeg: desktopServices.ffmpegRecorder,
		cpal: desktopServices.cpalRecorder,
	};
	return recorderMap[settings.value['recording.method']];
}
```
