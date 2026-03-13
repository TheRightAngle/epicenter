# transcribe-rs 0.3.0 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Whispering from `transcribe-rs 0.2.9` to `0.3.0` without intended user-facing behavior changes, leaving Windows GPU work for a separate follow-up patch.

**Architecture:** Keep the migration inside the existing Tauri transcription bridge. Update dependency features, replace the old `engines::*` integration with the new `onnx::*` / `whisper_cpp::*` API, preserve the current Tauri command contract, and verify the workspace still builds cleanly.

**Tech Stack:** Rust, Tauri, Bun, SvelteKit, `transcribe-rs 0.3.0`

---

### Task 1: Upgrade the dependency contract

**Files:**
- Modify: `apps/whispering/src-tauri/Cargo.toml`

**Step 1: Run the failing baseline compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL after the version bump until the Rust integration is ported.

**Step 2: Update the dependency declarations**

Set:

```toml
[target.'cfg(windows)'.dependencies]
transcribe-rs = { version = "0.3.0", features = ["onnx"] }

[target.'cfg(not(windows))'.dependencies]
transcribe-rs = { version = "0.3.0", features = ["onnx", "whisper-cpp"] }
```

Keep the existing comments that explain the current Windows product policy where they still make sense.

**Step 3: Re-run the compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL in the Rust transcription bridge because the old `engines::*` imports and trait names no longer exist.

**Step 4: Commit**

```bash
git add apps/whispering/src-tauri/Cargo.toml
git commit -m "chore: bump whispering to transcribe-rs 0.3.0"
```

### Task 2: Port the model manager to the 0.3.0 types

**Files:**
- Modify: `apps/whispering/src-tauri/src/transcription/model_manager.rs`

**Step 1: Run a focused compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL with unresolved `transcribe_rs::engines::*` imports and missing `TranscriptionEngine`.

**Step 2: Replace the old model types with the new ones**

Update the file to use:

```rust
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineVariant};
use transcribe_rs::onnx::Quantization;
use transcribe_rs::whisper_cpp::WhisperEngine;
use transcribe_rs::SpeechModel;
```

Adjust the `Engine` enum to store loaded model instances, and change each loader path to the `Model::load(...)` style used by `0.3.0`.

**Step 3: Re-run the compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL in `transcription/mod.rs` until the Tauri commands are ported.

**Step 4: Commit**

```bash
git add apps/whispering/src-tauri/src/transcription/model_manager.rs
git commit -m "refactor: port transcription model manager to transcribe-rs 0.3.0"
```

### Task 3: Port the Tauri transcription commands

**Files:**
- Modify: `apps/whispering/src-tauri/src/transcription/mod.rs`

**Step 1: Run the failing compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL in the Tauri command handlers because `transcribe_samples(...)` and the old params no longer match the crate API.

**Step 2: Rewrite the command adapters**

Make these direct replacements:

```rust
// Whisper
use transcribe_rs::{SpeechModel, TranscribeOptions};
use transcribe_rs::whisper_cpp::{WhisperEngine, WhisperInferenceParams};

// Parakeet
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};

// Moonshine
use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineParams, MoonshineVariant};
```

Then:

- build `TranscribeOptions` from the existing command arguments
- keep Parakeet segment timestamps
- keep the current Moonshine variant parsing from the model directory name
- keep the current `TranscriptionError` mapping and mutex-poison recovery
- keep the current Windows “Whisper unavailable” and “Moonshine unavailable” behavior

**Step 3: Re-run the compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: PASS, or fail only on small integration mismatches that can be fixed in place before moving on.

**Step 4: Commit**

```bash
git add apps/whispering/src-tauri/src/transcription/mod.rs
git commit -m "refactor: port whispering transcription commands to transcribe-rs 0.3.0"
```

### Task 4: Verify the migration against the existing workspace checks

**Files:**
- Verify only:
  - `apps/whispering/src-tauri/Cargo.toml`
  - `apps/whispering/src-tauri/src/transcription/model_manager.rs`
  - `apps/whispering/src-tauri/src/transcription/mod.rs`

**Step 1: Run the Rust check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: PASS

**Step 2: Run the app checks**

Run: `bun run --cwd apps/whispering typecheck`
Expected: PASS

Run: `bun run --cwd apps/whispering build`
Expected: PASS

**Step 3: Inspect the final diff**

Run: `git diff --check`
Expected: PASS with no whitespace or patch-format errors.

**Step 4: Commit**

```bash
git add apps/whispering/src-tauri/Cargo.toml apps/whispering/src-tauri/src/transcription/model_manager.rs apps/whispering/src-tauri/src/transcription/mod.rs
git commit -m "chore: finish transcribe-rs 0.3.0 migration"
```

### Task 5: Hand off to the Windows GPU follow-up

**Files:**
- Modify later: `apps/whispering/src-tauri/Cargo.toml`
- Modify later: `apps/whispering/src-tauri/src/transcription/model_manager.rs`
- Modify later: vendor or forked `transcribe-rs` ONNX session helper

**Step 1: Capture the follow-up boundary**

Write down that the migration intentionally excludes:

- DirectML provider selection
- CUDA/NVIDIA selection policy
- Windows adapter choice

**Step 2: Confirm the next patch starts from the clean baseline**

Run: `git status --short`
Expected: clean working tree after the migration commits.

**Step 3: Commit**

No code commit here if Task 4 already produced the final migration commit.
