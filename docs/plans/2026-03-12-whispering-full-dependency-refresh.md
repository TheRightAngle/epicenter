# Whispering Full Dependency Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Whispering to the latest stable dependencies that can be made compatible, repair the resulting breakage, and keep the forked unsigned Windows release build working.

**Architecture:** Refresh the dependency manifests in one branch-wide sweep across the Bun workspace, app-local JavaScript packages, and Rust/Tauri crates. Then fix the compatibility fallout in the narrowest places needed so the frontend build, desktop runtime path, and release workflow all work again without changing the product unnecessarily.

**Tech Stack:** Bun, SvelteKit, Vite, TypeScript, Tauri 2, Rust, Cargo, GitHub Actions

---

### Task 1: Capture the current dependency baseline

**Files:**
- Modify: `package.json`
- Modify: `apps/whispering/package.json`
- Modify: `apps/whispering/src-tauri/Cargo.toml`
- Test: `bun.lock`
- Test: `apps/whispering/src-tauri/Cargo.lock`

**Step 1: Verify the feature worktree is the active workspace**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 status --short --branch`
Expected: branch is `codex/transcribe-rs-0-3-0` and the worktree is clean before edits

**Step 2: Record the current direct JavaScript and Rust dependency manifests**

Run: `sed -n '1,220p' /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/package.json`
Run: `sed -n '1,220p' /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/package.json`
Run: `sed -n '1,220p' /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/src-tauri/Cargo.toml`
Expected: current manifest contents are visible for comparison

**Step 3: Capture the current verification baseline**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering typecheck`
Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering build`
Expected: current pre-upgrade state is recorded before dependency changes

### Task 2: Refresh JavaScript and workspace dependencies

**Files:**
- Modify: `package.json`
- Modify: `apps/whispering/package.json`
- Modify: `bun.lock`

**Step 1: Collect exact latest stable JavaScript versions**

Run: `bun outdated --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0`
Expected: outdated direct dependencies are listed with available stable versions

**Step 2: Update the root workspace catalog and app-local JavaScript manifests**

Modify the direct dependency ranges in:
- `/home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/package.json`
- `/home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/package.json`

Set each package to the newest compatible stable version chosen for this pass.

**Step 3: Regenerate the Bun lockfile**

Run: `bun install` from `/home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0`
Expected: `bun.lock` updates successfully

### Task 3: Refresh Rust and Tauri dependencies

**Files:**
- Modify: `apps/whispering/src-tauri/Cargo.toml`
- Modify: `apps/whispering/src-tauri/Cargo.lock`

**Step 1: Collect exact latest stable crate versions**

Run: `cargo outdated --manifest-path /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/src-tauri/Cargo.toml -R`
Expected: current Rust crate updates are listed

**Step 2: Update direct Rust and Tauri dependency versions**

Modify `/home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/src-tauri/Cargo.toml` so direct dependencies track the latest stable versions that can be made compatible in this pass.

**Step 3: Regenerate the Cargo lockfile**

Run: `cargo update --manifest-path /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering/src-tauri/Cargo.toml`
Expected: `Cargo.lock` updates successfully

### Task 4: Repair frontend and guest-plugin fallout

**Files:**
- Modify: `apps/whispering/src/**/*`
- Modify: `packages/**/*`
- Test: `apps/whispering/package.json`

**Step 1: Run the frontend typecheck and collect errors**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering typecheck`
Expected: any Svelte, TypeScript, or guest-plugin regressions are reported with file paths

**Step 2: Fix the minimum set of frontend compatibility issues**

Update the affected files so the latest dependency stack compiles again. Prioritize:
- Tauri guest plugin API changes
- Svelte or SvelteKit typing changes
- service SDK call-site changes

**Step 3: Re-run typecheck until clean**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering typecheck`
Expected: exits `0`

### Task 5: Repair native and release-path fallout

**Files:**
- Modify: `apps/whispering/src-tauri/src/**/*`
- Modify: `apps/whispering/src-tauri/build.rs`
- Modify: `.github/workflows/release.whispering.yml` only if a dependency change requires it

**Step 1: Run the app build and collect failures**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering build`
Expected: any Rust, Tauri, or release-path regressions are reported

**Step 2: Fix the minimum set of native compatibility issues**

Update the affected Rust or workflow files so the app builds again with the refreshed dependency set.

**Step 3: Re-run the build until clean**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering build`
Expected: exits `0`

### Task 6: Verify the Parakeet download path and Windows release build

**Files:**
- Test: `apps/whispering/src/lib/components/settings/LocalModelDownloadCard.svelte`
- Test: `.github/workflows/release.whispering.yml`

**Step 1: Confirm the HTTP plugin mismatch is resolved in the installed dependency set**

Run: `rg -n "streamChannel|fetch_read_body" /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/node_modules/@tauri-apps/plugin-http /home/dev/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-http-*`
Expected: the guest and native implementations agree on the streaming protocol, or the app has a local compatibility fix

**Step 2: Check the worktree diff**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 status --short`
Expected: only the intended dependency, lockfile, and compatibility-fix files are modified

**Step 3: Push the branch**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 push therightangle codex/transcribe-rs-0-3-0`
Expected: push succeeds

**Step 4: Run the unsigned release workflow**

Run: `gh workflow run release.whispering.yml --repo TheRightAngle/epicenter -f tag=v0.0.0-codex-20260312-unsigned1`
Expected: workflow dispatch succeeds

**Step 5: Verify the GitHub Actions result**

Run: `gh run watch --repo TheRightAngle/epicenter <run-id>`
Expected: run completes successfully and Windows assets are published

### Task 7: Final verification and commit

**Files:**
- Modify: all intended dependency and compatibility-fix files

**Step 1: Run final local verification**

Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering typecheck`
Run: `bun run --cwd /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0/apps/whispering build`
Expected: both commands exit `0`

**Step 2: Review the final diff**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 diff --stat`
Expected: the change set matches the dependency refresh and compatibility fixes only

**Step 3: Commit the completed refresh**

Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 add package.json bun.lock apps/whispering/package.json apps/whispering/src-tauri/Cargo.toml apps/whispering/src-tauri/Cargo.lock .github/workflows/release.whispering.yml apps/whispering packages`
Run: `git -C /home/dev/projects/whispering/.worktrees/transcribe-rs-0-3-0 commit -m "chore: refresh whispering dependencies"`
Expected: commit succeeds
