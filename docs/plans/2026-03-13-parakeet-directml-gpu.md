# Parakeet DirectML GPU Acceleration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional Windows DirectML acceleration mode for local Parakeet transcription while keeping the current CPU path intact.

**Architecture:** Patch `transcribe-rs 0.3.0` locally to support runtime ONNX execution-provider selection, then thread a Parakeet-only acceleration setting from Whispering’s Svelte settings UI through the Tauri transcription command into `ModelManager`.

**Tech Stack:** Bun, Svelte, Tauri 2, Rust, ONNX Runtime, `transcribe-rs 0.3.0`

---

### Task 1: Add the Parakeet acceleration setting surface

**Files:**
- Modify: `apps/whispering/src/lib/settings/settings.ts`
- Modify: `apps/whispering/src/routes/(app)/(config)/settings/transcription/+page.svelte`
- Test: `apps/whispering/src/lib/settings/settings.test.ts`

**Step 1: Write the failing test**

Add a test that proves the settings source includes the new Parakeet acceleration default.

**Step 2: Run test to verify it fails**

Run: `bun test apps/whispering/src/lib/settings/settings.test.ts`
Expected: FAIL because the new setting is not present yet.

**Step 3: Write minimal implementation**

Add:
- `transcription.parakeet.acceleration` with default `cpu`
- a Parakeet-only UI control in the transcription settings page

**Step 4: Run test to verify it passes**

Run: `bun test apps/whispering/src/lib/settings/settings.test.ts`
Expected: PASS

### Task 2: Thread acceleration mode through the Whispering Parakeet path

**Files:**
- Modify: `apps/whispering/src/lib/query/transcription.ts`
- Modify: `apps/whispering/src/lib/services/transcription/local/parakeet.ts`
- Modify: `apps/whispering/src-tauri/src/transcription/mod.rs`

**Step 1: Write the failing test**

Add or extend a targeted test around the Parakeet invocation path if practical. If the existing test surface is too thin here, keep this task covered by compile-time and integration verification and avoid fake tests.

**Step 2: Run the relevant verification**

Run: `bun run --cwd apps/whispering typecheck`
Expected: FAIL after the setting is added but before the new parameter is threaded everywhere.

**Step 3: Write minimal implementation**

Pass the selected acceleration mode from:
- settings
- to query layer
- to the Parakeet local service
- to the Tauri `transcribe_audio_parakeet` command

**Step 4: Re-run typecheck**

Run: `bun run --cwd apps/whispering typecheck`
Expected: PASS or expose the next missing piece.

### Task 3: Make ModelManager cache Parakeet engines by path and acceleration

**Files:**
- Modify: `apps/whispering/src-tauri/src/transcription/model_manager.rs`

**Step 1: Write the failing test or compile check**

If unit tests are practical, add one for cache identity. If not, use the compiler-driven red phase by changing the function signature before implementation.

**Step 2: Verify red**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: FAIL because the new acceleration-aware API is not fully wired.

**Step 3: Write minimal implementation**

Update the Parakeet load/cache path so `(model_path, acceleration_mode)` determines whether to reuse or reload the engine.

**Step 4: Re-run compile check**

Run: `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`
Expected: progress toward green, subject to host dependency limits.

### Task 4: Vendor and patch transcribe-rs for provider selection

**Files:**
- Create: `third_party/transcribe-rs/` or equivalent repo-local patched crate path
- Modify: patched `transcribe-rs` files under `src/onnx/session.rs`
- Modify: patched `transcribe-rs` Parakeet-facing files if needed
- Modify: `apps/whispering/src-tauri/Cargo.toml`

**Step 1: Write the failing test**

Add focused Rust tests in the patched crate if feasible for provider selection and session-builder configuration. Keep them narrow.

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path <patched-transcribe-rs>/Cargo.toml`
Expected: FAIL because provider selection support does not exist yet.

**Step 3: Write minimal implementation**

Add:
- a tiny ONNX execution-provider enum
- CPU session path unchanged
- DirectML session path with:
  - DirectML EP registration
  - memory pattern disabled
  - parallel execution disabled
- the `ort` `directml` feature

Then point Whispering’s Windows build to the patched crate via Cargo override or path dependency.

**Step 4: Run tests to verify it passes**

Run: `cargo test --manifest-path <patched-transcribe-rs>/Cargo.toml`
Expected: PASS for the new targeted tests.

### Task 5: Add Windows-only UX copy and error handling

**Files:**
- Modify: `apps/whispering/src/routes/(app)/(config)/settings/transcription/+page.svelte`
- Modify: `apps/whispering/src-tauri/src/transcription/mod.rs`

**Step 1: Write the failing test**

If the current test surface is too light for this UI text, skip artificial tests and rely on typecheck/build plus a targeted manual review.

**Step 2: Write minimal implementation**

Add concise Parakeet UI copy explaining:
- `GPU (DirectML)` is Windows-only
- it may use supported GPU hardware, including NVIDIA GPUs
- failures surface as transcription/model-load errors

Keep the copy limited to the Parakeet settings block.

**Step 3: Verify**

Run: `bun run --cwd apps/whispering typecheck`
Expected: PASS

### Task 6: Full verification and Windows build handoff

**Files:**
- Verify: `apps/whispering/src/lib/settings/settings.ts`
- Verify: `apps/whispering/src/lib/query/transcription.ts`
- Verify: `apps/whispering/src/lib/services/transcription/local/parakeet.ts`
- Verify: `apps/whispering/src-tauri/src/transcription/mod.rs`
- Verify: `apps/whispering/src-tauri/src/transcription/model_manager.rs`
- Verify: patched `transcribe-rs`

**Step 1: Run focused JS verification**

Run:
- `bun test apps/whispering/src/lib/settings/settings.test.ts`
- any new targeted tests added during the implementation

Expected: PASS

**Step 2: Run app verification**

Run:
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`

Expected: PASS

**Step 3: Run Rust verification as far as host allows**

Run:
- `cargo check --manifest-path apps/whispering/src-tauri/Cargo.toml`

Expected: either PASS or only known host-library blockers unrelated to feature logic.

**Step 4: Prepare Windows verification**

Push branch and run the Windows GitHub build.

Manual host verification:
- install updated build
- test Parakeet on `CPU`
- switch to `GPU (DirectML)`
- retest transcription speed and correctness
- confirm clear error behavior if DirectML init fails

**Step 5: Commit**

```bash
git add docs/plans/2026-03-13-parakeet-directml-gpu-design.md \
  docs/plans/2026-03-13-parakeet-directml-gpu.md \
  apps/whispering/src/lib/settings/settings.ts \
  apps/whispering/src/routes/(app)/(config)/settings/transcription/+page.svelte \
  apps/whispering/src/lib/query/transcription.ts \
  apps/whispering/src/lib/services/transcription/local/parakeet.ts \
  apps/whispering/src-tauri/src/transcription/mod.rs \
  apps/whispering/src-tauri/src/transcription/model_manager.rs \
  apps/whispering/src-tauri/Cargo.toml
git commit -m "feat: add DirectML acceleration for Parakeet on Windows"
```
