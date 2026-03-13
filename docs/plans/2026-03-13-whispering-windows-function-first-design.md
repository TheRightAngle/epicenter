# Whispering Windows Function-First Design

Date: 2026-03-13
Repo: /home/dev/projects/whispering/.worktrees/windows-function-first-fixes
Branch: codex/windows-function-first-fixes

## Goal

Fix the Windows issues that can make local use less reliable or more confusing, while avoiding speculative hardening or lockdown work that could make the app harder to use on a single trusted machine.

## Operating Principle

- Function first.
- Single-user local workflow first.
- Only make security/config changes that are obviously safe and clearly reduce breakage risk.
- Avoid “enterprise” tightening that could break desktop automation, file access, local models, or recorder behavior.

## Scope

### 1. Windows lifecycle

- Add real uninstall cleanup for app data and downloaded local models.
- Fix uninstall finish behavior so uninstall does not bounce back into install flow.
- Keep updater/build behavior aligned with the code actually being shipped when practical and low-risk.

### 2. Recording correctness

- Fix CPAL session cleanup leaks on start/stop failure paths.
- Fix stale module-level recording ID state after failed starts.
- Fix misleading “automatic microphone fallback” behavior where possible without risky native churn.
- Keep process control behavior correct for FFmpeg/manual recording.

### 3. Local model lifecycle

- Stop treating any non-empty local model path as “configured”.
- Make model downloads transactional enough to avoid partial “installed” states.
- Clean up partial multi-file model directories on failure.
- Remove noisy or misleading success state where it overstates readiness.

### 4. Desktop integration polish

- Surface real global shortcut registration failures instead of claiming success.
- Only make low-risk desktop permission/config cleanup if it is clearly non-breaking.

## Out of Scope

- Strict least-privilege security hardening.
- Broad CSP/permission lockdown that could break current desktop behavior.
- Large architectural rewrites of recorder or transcription internals.
- New product features unrelated to the current Windows reliability issues.

## Success Criteria

- Uninstall with app-data removal actually removes Whispering app data and local models.
- Uninstall exits cleanly.
- CPAL recording errors do not leave the session hanging.
- Local model UI only shows ready/configured when the install is actually valid.
- Failed model downloads do not leave misleading partial installs behind.
- Global shortcut registration failures are surfaced honestly.
- Existing typecheck/build still pass.
