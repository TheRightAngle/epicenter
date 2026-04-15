# Moonshine Integration Handoff

## Summary

Added Moonshine as a new local transcription engine to Whispering, integrating with transcribe-rs 0.2.0.

## What Was Done

### Rust Side (Already Committed Previously)

1. **Cargo.toml**: Added `moonshine` feature flag to transcribe-rs dependency
2. **model_manager.rs**: Added `MoonshineEngine` variant and initialization logic
3. **lib.rs**: Added `transcribe_audio_moonshine` Tauri command

### TypeScript Side

1. **moonshine.ts** (new file):
   - `MOONSHINE_MODELS` config with two models: tiny-en (~30MB) and base-en (~65MB)
   - `extractVariantFromPath()` helper to derive model variant from directory name
   - `createMoonshineTranscriptionService()` with full error handling

2. **types.ts**:
   - Added `MoonshineModelConfig` type (simplified - no redundant `variant` field)

3. **registry.ts**:
   - Added moonshine to `TRANSCRIPTION_SERVICE_IDS`
   - Added moonshine service entry and capabilities

4. **settings.ts**:
   - Added `transcription.moonshine.modelPath` setting
   - Removed redundant `transcription.moonshine.variant` (derived from path)

5. **transcription.ts** (query layer):
   - Added moonshine case in the transcribe switch statement

6. **UI Components**:
   - LocalModelSelector.svelte: Added moonshine case
   - LocalModelDownloadCard.svelte: Added moonshine case
   - +page.svelte (transcription settings): Added moonshine tab

## Key Design Decisions

### Variant Inference from Directory Name

Moonshine ONNX files don't self-describe their architecture (unlike Whisper .bin or Parakeet config.json). Rather than storing variant as a separate setting, we:

1. Use directory naming convention: `moonshine-{variant}-{lang}` (e.g., `moonshine-tiny-en`)
2. Extract variant at transcription time via `extractVariantFromPath()`
3. Pass variant to Rust command which converts to `MoonshineModelParams::tiny()` or `::base()`

This eliminates redundant metadata while keeping the design simple.

### Model Architecture Reference

| Variant | Layers | Head Dim | Size (quantized) |
|---------|--------|----------|------------------|
| tiny    | 6      | 36       | ~30 MB           |
| base    | 8      | 52       | ~65 MB           |

Language-specific variants (ar, zh, ja, ko, uk, vi, es) share architecture with their base variant but have different tokenizers/training.

### Cross-Platform Path Handling

Uses Tauri's `sep()` from `@tauri-apps/api/path` instead of hardcoded `/` for Windows compatibility.

## Files Modified

```
apps/whispering/src/lib/services/transcription/local/moonshine.ts (new)
apps/whispering/src/lib/services/transcription/local/types.ts
apps/whispering/src/lib/services/transcription/index.ts
apps/whispering/src/lib/services/transcription/registry.ts
apps/whispering/src/lib/query/transcription.ts
apps/whispering/src/lib/settings/settings.ts
apps/whispering/src/lib/constants/paths.ts
apps/whispering/src/lib/components/settings/selectors/LocalModelSelector.svelte
apps/whispering/src/lib/components/settings/selectors/LocalModelDownloadCard.svelte
apps/whispering/src/lib/components/settings/selectors/TranscriptionSelector.svelte
apps/whispering/src/routes/(app)/(config)/settings/transcription/+page.svelte
```

## HuggingFace Model URLs

- Base: `https://huggingface.co/UsefulSensors/moonshine/resolve/main`
- ONNX files: `onnx/merged/{variant}/quantized/`
- Tokenizer: `ctranslate2/tiny/tokenizer.json` (shared across all variants)

## Potential Future Work

1. Add language-specific models when quantized versions become available
2. Consider caching the `sep()` call since it's synchronous but called on every transcription
3. Add GPU acceleration options if transcribe-rs exposes them for Moonshine
