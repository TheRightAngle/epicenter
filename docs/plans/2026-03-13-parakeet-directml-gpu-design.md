# Parakeet DirectML GPU Acceleration Design

## Goal

Add optional Windows GPU acceleration for local Parakeet transcription in Whispering using ONNX Runtime DirectML, while preserving the existing CPU path and keeping the feature narrowly scoped.

## Why DirectML First

Whispering already runs Parakeet through `transcribe-rs 0.3.0` and ONNX Runtime on Windows. DirectML is the cleanest Windows GPU path because it fits the existing ONNX stack and avoids the heavier deployment and runtime constraints of CUDA. It can still use supported NVIDIA GPUs on Windows, but it does not require Whispering to become a CUDA-specific app.

The implementation should take inspiration from `transcribe-rs` PR `#53` for the DirectML session constraints and PR `#49` for runtime provider selection, but it should use a smaller, Whispering-specific API surface.

## Scope

This feature only affects:

- Windows
- local Parakeet transcription
- the ONNX Runtime session provider used for Parakeet

It does not change:

- cloud transcription providers
- Whisper C++
- Moonshine
- Parakeet model files or quantization
- the general recording pipeline

## User-Facing Behavior

Add a Parakeet-only acceleration setting in the transcription settings screen:

- `CPU`
- `GPU (DirectML)`

Default behavior should remain conservative and predictable. `CPU` remains the default in the first pass. If the user selects `GPU (DirectML)`, Whispering attempts to load Parakeet with DirectML on Windows.

If DirectML session creation fails, Whispering should surface a clear error instead of silently pretending GPU acceleration is active. Automatic fallback can be added later if needed, but the first version should make the selected mode truthful.

## Runtime Design

### Settings

Add a new setting:

- `transcription.parakeet.acceleration`

Allowed values:

- `cpu`
- `directml`

This setting belongs next to the existing Parakeet model path in the transcription settings UI.

### Tauri Command Path

The existing Parakeet command in `apps/whispering/src-tauri/src/transcription/mod.rs` should accept the selected acceleration mode and pass it into `ModelManager`.

### Model Cache Identity

`ModelManager` should treat the loaded Parakeet engine as keyed by:

- model path
- acceleration mode

That prevents Whispering from reusing a CPU-loaded session after the user switches to GPU mode, or vice versa.

## transcribe-rs Patch Shape

Do not build this by scattering ONNX provider logic inside Whispering. The clean seam is a repo-local patched `transcribe-rs 0.3.0` that adds a tiny ONNX execution-provider selection API.

Recommended API shape:

- `OnnxExecutionProvider::Cpu`
- `OnnxExecutionProvider::DirectML { device_id: Option<i32> }`

The patch should:

- keep the current CPU path unchanged
- enable the `ort` `directml` feature
- add provider-aware session creation in `src/onnx/session.rs`
- keep the rest of `transcribe-rs` intact

## DirectML Session Requirements

DirectML on ONNX Runtime requires Windows-specific session settings. The patched session builder should:

- register the DirectML execution provider
- disable memory pattern optimization
- disable parallel execution

Those requirements come from the DirectML provider guidance and match the important part of `transcribe-rs` PR `#53`.

## Dependency Strategy

Use a repo-local crate override rather than mutating cargo registry state:

- vendor a patched `transcribe-rs` into the repo, or add a local path override
- point Whispering’s Tauri crate at that patched source for implementation and builds

This keeps the dependency explicit, reproducible, and easy to review.

## Verification

### Local code-level verification

- Rust tests for provider-selection/session-builder behavior where feasible
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`

### Windows runtime verification

- build a Windows installer on GitHub
- install on the Windows 11 host
- verify Parakeet still works in `CPU`
- verify `GPU (DirectML)` loads and transcribes successfully
- compare behavior and error reporting when GPU initialization fails

## Future Extensions

If the DirectML implementation is stable, later follow-ups could add:

- `Auto` mode
- adapter selection
- optional CPU fallback UX
- deeper telemetry or diagnostics

Those are intentionally out of scope for the first pass.
