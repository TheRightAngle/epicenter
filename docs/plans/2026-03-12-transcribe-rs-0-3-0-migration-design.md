# transcribe-rs 0.3.0 Migration Design

**Date:** 2026-03-12

## Goal

Move Whispering from `transcribe-rs 0.2.9` to `0.3.0` without intended user-facing behavior changes, so the app has a clean baseline for a separate Windows Parakeet GPU patch.

## Scope

- Update the Rust-side integration in `apps/whispering/src-tauri`.
- Keep the frontend contract unchanged.
- Keep Windows product behavior unchanged for now: Parakeet remains the local Windows path, and Moonshine-on-Windows stays out of scope.
- Do not add GPU execution provider changes in this migration.

## Current Context

Whispering currently uses the old `transcribe-rs` `engines::*` API and `TranscriptionEngine` trait in:

- `apps/whispering/src-tauri/Cargo.toml`
- `apps/whispering/src-tauri/src/transcription/model_manager.rs`
- `apps/whispering/src-tauri/src/transcription/mod.rs`

`transcribe-rs 0.3.0` is a breaking release. It moves:

- ONNX models under `transcribe_rs::onnx::*`
- Whisper under `transcribe_rs::whisper_cpp::*`
- The generic local-model API to `SpeechModel` plus `TranscribeOptions`

## Proposed Design

### Dependency And Feature Mapping

- Windows: use `transcribe-rs = "0.3.0"` with `["onnx"]`.
- macOS/Linux: use `transcribe-rs = "0.3.0"` with `["onnx", "whisper-cpp"]`.
- Keep app-level service exposure unchanged even if `0.3.0` could technically support more on Windows.

### Adapter Layer

Replace the old engine-specific integration with the new `0.3.0` types:

- `engines::parakeet::ParakeetEngine` -> `onnx::parakeet::ParakeetModel`
- `engines::moonshine::MoonshineEngine` -> `onnx::moonshine::MoonshineModel`
- `engines::whisper::WhisperEngine` -> `whisper_cpp::WhisperEngine`

`ModelManager` continues to own one loaded model at a time. The main structural change is that model creation becomes `Model::load(...)` instead of `new() + load_model...`.

### Command-Level Behavior Mapping

- Whisper commands keep the existing Tauri shape and return value. Internally, they translate the current `language` argument and related knobs into `0.3.0` `TranscribeOptions` and any remaining engine-specific parameters.
- Parakeet commands switch to `onnx::parakeet::ParakeetParams` and keep segment timestamp granularity so the current result handling remains stable.
- Moonshine commands switch to `onnx::moonshine::MoonshineVariant` and preserve the current variant-from-directory-name logic.

### Error Handling And Compatibility

- Preserve the current `TranscriptionError` boundary.
- Preserve mutex-poison recovery behavior in `ModelManager`.
- Normalize any internal output differences at the Tauri command boundary so the frontend contract stays unchanged.
- Do not redesign caching, onboarding, settings, or model-path conventions during this migration.

## Verification

The migration is complete only when the crate bump is boring:

- `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`

## Follow-On Windows Work

After this migration lands, the Windows Parakeet GPU work becomes a separate second phase:

- patch the `0.3.0` ONNX session layer rather than backporting into `0.2.9`
- use PR `#53` as reference for DirectML session requirements
- decide explicitly whether the Windows implementation should be generic DirectML or NVIDIA-first behavior
