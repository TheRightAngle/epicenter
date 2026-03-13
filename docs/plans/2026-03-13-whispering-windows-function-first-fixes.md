# Whispering Windows Function-First Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Windows lifecycle, recorder, model-install, and shortcut issues that reduce local reliability without adding speculative lockdowns.

**Architecture:** Keep the current app architecture intact. Fix the failure-path bugs in place, extract small helpers only where needed for testability, and prefer narrow behavior changes over structural rewrites. Treat uninstall, recorder cleanup, model lifecycle, and shortcut registration as separate work buckets.

**Tech Stack:** Bun, Svelte 5, Tauri 2, TypeScript, Rust, NSIS/Tauri Windows bundling

---

### Task 1: Windows Uninstall Ownership

**Files:**
- Modify: `apps/whispering/src-tauri/tauri.conf.json`
- Create: `apps/whispering/src-tauri/windows/nsis/*`
- Test: `apps/whispering/src-tauri/windows/nsis` hook contents via source inspection

**Step 1: Write the failing test**

Create a source-level test that asserts the Windows bundle config includes uninstall hook wiring and that the hook assets exist.

**Step 2: Run test to verify it fails**

Run: `bun test <new-test-file>`
Expected: FAIL because current config has no uninstall hook/template wiring.

**Step 3: Write minimal implementation**

- Add NSIS hook/template wiring in `tauri.conf.json`.
- Add hook logic to delete `%LOCALAPPDATA%\\Whispering` and `%LOCALAPPDATA%\\com.bradenwong.whispering` when app-data removal is requested.
- Ensure uninstall finish exits cleanly instead of returning to install flow.

**Step 4: Run test to verify it passes**

Run: `bun test <new-test-file>`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/whispering/src-tauri/tauri.conf.json apps/whispering/src-tauri/windows/nsis
git commit -m "fix: own windows uninstall cleanup flow"
```

### Task 2: Recorder Failure-Path Cleanup

**Files:**
- Modify: `apps/whispering/src/lib/services/desktop/recorder/cpal.ts`
- Modify: `apps/whispering/src/lib/query/recorder.ts`
- Modify: `apps/whispering/src/lib/services/desktop/recorder/ffmpeg.ts`
- Test: `apps/whispering/src/lib/services/desktop/recorder/cpal.test.ts`
- Test: `apps/whispering/src/lib/query/recorder.test.ts`

**Step 1: Write the failing tests**

- Add a test proving CPAL closes the recording session when `start_recording` fails after init.
- Add a test proving CPAL closes the session on `stopRecording()` early-return paths.
- Add a test proving `currentRecordingId` is cleared when start fails.

**Step 2: Run tests to verify they fail**

Run: `bun test apps/whispering/src/lib/services/desktop/recorder/cpal.test.ts apps/whispering/src/lib/query/recorder.test.ts`
Expected: FAIL on current cleanup/state behavior.

**Step 3: Write minimal implementation**

- Add `close_recording_session` cleanup in all CPAL failure paths.
- Clear stale `currentRecordingId` on start failure.
- Fix automatic fallback language/UI if needed so it does not over-promise “best microphone”.

**Step 4: Run tests to verify they pass**

Run: `bun test apps/whispering/src/lib/services/desktop/recorder/cpal.test.ts apps/whispering/src/lib/query/recorder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/whispering/src/lib/services/desktop/recorder/cpal.ts apps/whispering/src/lib/query/recorder.ts apps/whispering/src/lib/services/desktop/recorder/ffmpeg.ts apps/whispering/src/lib/services/desktop/recorder/cpal.test.ts apps/whispering/src/lib/query/recorder.test.ts
git commit -m "fix: clean recorder state on failure paths"
```

### Task 3: Local Model Readiness And Transactional Downloads

**Files:**
- Modify: `apps/whispering/src/lib/settings/transcription-validation.ts`
- Modify: `apps/whispering/src/lib/components/settings/selectors/TranscriptionSelector.svelte`
- Modify: `apps/whispering/src/lib/components/settings/LocalModelDownloadCard.svelte`
- Create: `apps/whispering/src/lib/components/settings/local-models.test.ts`

**Step 1: Write the failing tests**

- Add a test proving deleted/corrupt local models are not treated as configured.
- Add a test proving failed multi-file downloads clean up prior files/directories.
- Add a test proving downloads stage to temporary paths before activation.

**Step 2: Run tests to verify they fail**

Run: `bun test apps/whispering/src/lib/components/settings/local-models.test.ts`
Expected: FAIL on current behavior.

**Step 3: Write minimal implementation**

- Make readiness depend on actual model validity, not just non-empty path.
- Stage downloads through temp files/directories and only promote on success.
- Clean partial installs on failure.
- Remove duplicate or misleading success state where appropriate.

**Step 4: Run tests to verify they pass**

Run: `bun test apps/whispering/src/lib/components/settings/local-models.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/whispering/src/lib/settings/transcription-validation.ts apps/whispering/src/lib/components/settings/selectors/TranscriptionSelector.svelte apps/whispering/src/lib/components/settings/LocalModelDownloadCard.svelte apps/whispering/src/lib/components/settings/local-models.test.ts
git commit -m "fix: make local model installs transactional"
```

### Task 4: Global Shortcut Truthfulness

**Files:**
- Modify: `apps/whispering/src/lib/services/desktop/global-shortcut-manager.ts`
- Create: `apps/whispering/src/lib/services/desktop/global-shortcut-manager.test.ts`

**Step 1: Write the failing test**

Add a test proving real registration failures are returned to callers instead of being silently treated as success.

**Step 2: Run test to verify it fails**

Run: `bun test apps/whispering/src/lib/services/desktop/global-shortcut-manager.test.ts`
Expected: FAIL because the current implementation swallows all registration errors.

**Step 3: Write minimal implementation**

- Narrow the false-positive handling if needed.
- Return real errors so the UI can surface them honestly.

**Step 4: Run test to verify it passes**

Run: `bun test apps/whispering/src/lib/services/desktop/global-shortcut-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/whispering/src/lib/services/desktop/global-shortcut-manager.ts apps/whispering/src/lib/services/desktop/global-shortcut-manager.test.ts
git commit -m "fix: surface real global shortcut registration failures"
```

### Task 5: Final Verification

**Files:**
- Verify only

**Step 1: Run focused tests**

Run:
- `bun test apps/whispering/src/lib/services/desktop/recorder/cpal.test.ts`
- `bun test apps/whispering/src/lib/query/recorder.test.ts`
- `bun test apps/whispering/src/lib/components/settings/local-models.test.ts`
- `bun test apps/whispering/src/lib/services/desktop/global-shortcut-manager.test.ts`

Expected: PASS

**Step 2: Run existing tests**

Run:
- `bun test apps/whispering/src/lib/settings/default-transcription-service.test.ts apps/whispering/src/lib/state/vad-stream-lifecycle.test.ts`

Expected: PASS

**Step 3: Run app verification**

Run:
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`

Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: improve whispering windows reliability"
```
