# Windows DPI Resume Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Whispering's Windows wake/resume DPI bug so restored windows return at the correct inner scale without requiring a manual resize.

**Architecture:** Add a small Tauri-only app-shell helper that listens for scale-change and restore-adjacent events, compares browser `devicePixelRatio` against Tauri's `scaleFactor()`, and performs a one-shot window-size nudge only when the scale state is stale. Keep the logic isolated in one helper and wire it into the main app shell.

**Tech Stack:** Svelte 5, Tauri v2 window API, Bun test

---

### Task 1: Add a failing test for the window-scale recovery helper

**Files:**
- Create: `apps/whispering/src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts`

**Step 1: Write the failing test**

Cover these behaviors:
- does nothing outside Tauri
- subscribes to `onScaleChanged` and `onFocusChanged` in Tauri
- schedules only one recovery pass for clustered events
- calls the recovery nudge only when `devicePixelRatio` disagrees with Tauri `scaleFactor()`
- does not nudge when scale is already correct

**Step 2: Run test to verify it fails**

Run:

```bash
bun test 'src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts'
```

Expected: FAIL because the helper does not exist yet.

**Step 3: Commit**

```bash
git add 'apps/whispering/src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts'
git commit -m "test: cover windows dpi resume recovery"
```

### Task 2: Implement the minimal Tauri-only recovery helper

**Files:**
- Create: `apps/whispering/src/routes/(app)/_layout-utils/register-window-scale-recovery.ts`
- Modify: `apps/whispering/src/routes/(app)/_components/AppLayout.svelte`

**Step 1: Write minimal implementation**

Add a helper that:
- returns a cleanup function
- exits immediately outside Tauri
- subscribes to `getCurrentWindow().onScaleChanged(...)`
- subscribes to `getCurrentWindow().onFocusChanged(...)`
- subscribes to `document.visibilitychange`
- batches clustered events behind one scheduled recovery pass
- compares `window.devicePixelRatio` to `await currentWindow.scaleFactor()`
- if they differ meaningfully, reads the current physical size and nudges it by one pixel before restoring it

Wire it into `AppLayout.svelte` inside `onMount`, and call its cleanup in `onDestroy`.

**Step 2: Run focused test to verify it passes**

Run:

```bash
bun test 'src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts'
```

Expected: PASS

**Step 3: Commit**

```bash
git add 'apps/whispering/src/routes/(app)/_layout-utils/register-window-scale-recovery.ts' 'apps/whispering/src/routes/(app)/_components/AppLayout.svelte' 'apps/whispering/src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts'
git commit -m "fix: recover whispering window scale after wake"
```

### Task 3: Run the local verification ring

**Files:**
- Verify only

**Step 1: Run focused tests**

Run:

```bash
bun test 'src/routes/(app)/_layout-utils/register-window-scale-recovery.test.ts' 'src/routes/(app)/_layout-utils/register-onboarding.test.ts'
```

Expected: PASS

**Step 2: Run app verification**

Run:

```bash
bun run --cwd apps/whispering typecheck
bun run --cwd apps/whispering build
```

Expected:
- `svelte-check found 0 errors and 0 warnings`
- build exits `0`

**Step 3: Run git hygiene check**

Run:

```bash
git diff --check
```

Expected: no output

**Step 4: Commit if verification requires any tiny follow-up cleanup**

```bash
git add -A
git commit -m "test: verify windows dpi resume recovery"
```

Only if any follow-up edits were needed.
