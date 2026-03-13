# Fork-Safe Unsigned Release Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Whispering release builds finish on forks by falling back to unsigned Tauri builds whenever signing secrets are missing.

**Architecture:** Keep the existing `release.whispering.yml` workflow and add one decision step that selects between a signed and unsigned `tauri-action` path. The unsigned path avoids passing empty signing secrets and appends `--no-sign`, which is the specific fix for the fork failure we reproduced.

**Tech Stack:** GitHub Actions YAML, Tauri action, bash

---

### Task 1: Prepare the worktree for workflow edits

**Files:**
- Modify: `.git/info/sparse-checkout` indirectly via `git sparse-checkout add`

**Step 1: Ensure workflow files are present in the feature worktree**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 sparse-checkout add /.github /docs`
Expected: command exits `0`

**Step 2: Verify the workflow file is available**

Run: `ls /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/.github/workflows/release.whispering.yml`
Expected: file path is printed

### Task 2: Add a failing verification for the current workflow shape

**Files:**
- Test: `.github/workflows/release.whispering.yml`

**Step 1: Assert the release workflow currently has only the signed `tauri-action` path**

Run: `rg -n -- '--no-sign|Determine signing mode' /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/.github/workflows/release.whispering.yml`
Expected: no matches

**Step 2: Record the reproduced failure mode from the existing run**

Run: `gh run view 23024337185 --repo TheRightAngle/epicenter --job 66868421781 --log | rg -n 'failed to decode secret key|Finished 2 bundles'`
Expected: output shows both successful bundling and the signing failure

### Task 3: Implement conditional signed vs unsigned release steps

**Files:**
- Modify: `.github/workflows/release.whispering.yml`

**Step 1: Add a signing-mode decision step**

Implement a bash step that inspects the relevant secrets, writes `enabled=true|false`, and writes `args` with `--no-sign` appended when signing is unavailable.

**Step 2: Split the single `tauri-action` step into signed and unsigned variants**

- Signed variant:
  - runs only when signing is enabled
  - keeps the signing secrets env block
- Unsigned variant:
  - runs only when signing is disabled
  - passes only `CI`, `GITHUB_TOKEN`, and `APTABASE_KEY`
  - uses the computed args with `--no-sign`

**Step 3: Keep release metadata unchanged**

Preserve `projectPath`, `tagName`, `releaseName`, `releaseBody`, `releaseDraft`, and `prerelease` in both action paths.

### Task 4: Verify the workflow file locally

**Files:**
- Test: `.github/workflows/release.whispering.yml`

**Step 1: Confirm the new decision step and unsigned args exist**

Run: `rg -n -- 'Determine signing mode|--no-sign|steps\\.signing\\.outputs' /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/.github/workflows/release.whispering.yml`
Expected: matches for all three patterns

**Step 2: Validate YAML parses cleanly**

Run: `ruby -e "require 'yaml'; YAML.load_file('/home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/.github/workflows/release.whispering.yml'); puts 'ok'"`
Expected: `ok`

**Step 3: Check git diff for only the intended workflow/doc changes**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 status --short`
Expected: only the new docs and workflow file are changed

### Task 5: Push and validate on GitHub

**Files:**
- Modify: remote branch state

**Step 1: Push the updated branch**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 push therightangle codex/transcribe-rs-0-3-0`
Expected: push succeeds

**Step 2: Re-run the release workflow on the fork tag**

Run: `gh workflow run release.whispering.yml --repo TheRightAngle/epicenter -f tag=v0.0.0-codex-20260312`
Expected: workflow dispatch succeeds

**Step 3: Verify the new run completes**

Run: `gh run watch --repo TheRightAngle/epicenter <run-id>`
Expected: unsigned build jobs finish and release assets are uploaded
