# Minimize To Tray Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional desktop-only minimize-to-tray behavior without changing normal close behavior.

**Architecture:** Add one new flat setting, expose it in the General settings page, and register a tiny Tauri-only minimize watcher in the app shell. Reuse the existing tray icon menu and update its restore action to unminimize before showing the main window.

**Tech Stack:** Svelte 5, Tauri v2 window API, Bun test

---

### Task 1: Add the failing tests

**Files:**
- Create: `apps/whispering/src/lib/settings/minimize-to-tray.test.ts`
- Create: `apps/whispering/src/routes/(app)/_layout-utils/register-minimize-to-tray.test.ts`

**Step 1: Write the failing tests**

Cover:
- the settings schema includes `'system.minimizeToTray': 'boolean = false'`
- the General settings page exposes a `Minimize to tray` toggle
- the helper:
  - no-ops outside Tauri
  - does nothing when the setting is off
  - hides the window when minimized and the setting is on
  - unregisters its resize listener on cleanup

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test 'src/lib/settings/minimize-to-tray.test.ts' 'src/routes/(app)/_layout-utils/register-minimize-to-tray.test.ts'
```

Expected: FAIL because the setting, UI toggle, and helper do not exist yet.

### Task 2: Implement the setting, hook, and tray restore behavior

**Files:**
- Modify: `apps/whispering/src/lib/settings/settings.ts`
- Modify: `apps/whispering/src/routes/(app)/(config)/settings/+page.svelte`
- Create: `apps/whispering/src/routes/(app)/_layout-utils/register-minimize-to-tray.ts`
- Modify: `apps/whispering/src/routes/(app)/_components/AppLayout.svelte`
- Modify: `apps/whispering/src/lib/services/desktop/tray.ts`
- Modify: `apps/whispering/src-tauri/capabilities/default.json`

**Step 1: Write the minimal implementation**

- Add `'system.minimizeToTray': 'boolean = false'`
- Add one desktop-only `Minimize to tray` switch in General settings
- Add the Tauri-only minimize watcher helper
- Register the helper in `AppLayout.svelte` and clean it up on destroy
- Update tray `Show Window` to `unminimize()` before `show()`
- Add only the two extra window permissions needed by this feature

**Step 2: Run focused tests to verify they pass**

Run:

```bash
bun test 'src/lib/settings/minimize-to-tray.test.ts' 'src/routes/(app)/_layout-utils/register-minimize-to-tray.test.ts'
```

Expected: PASS

### Task 3: Run the local verification ring

**Files:**
- Verify only

**Step 1: Run app verification**

Run:

```bash
bun run --cwd apps/whispering typecheck
bun run --cwd apps/whispering build
```

Expected:
- `svelte-check found 0 errors and 0 warnings`
- build exits `0`

**Step 2: Run git hygiene check**

Run:

```bash
git diff --check
```

Expected: no output
