# Toast Visibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global toast visibility setting with `all`, `important-only`, and `off` modes while leaving OS notifications unchanged.

**Architecture:** Store the toast mode in the flat settings schema, expose it in General settings, and gate toast display centrally in the notify query layer before `services.toast.show(...)` is called. This keeps the behavior consistent without changing every notification caller.

**Tech Stack:** Svelte, Bun tests, arktype settings schema, Sonner toast service

---

### Task 1: Add Failing Tests

**Files:**
- Create: `apps/whispering/src/lib/query/toast-visibility.test.ts`
- Modify: `apps/whispering/src/lib/settings/settings.test.ts`

**Step 1: Write the failing tests**

- Add a focused unit test for the toast filtering helper behavior:
  - `all` shows every toast variant
  - `important-only` shows only `warning` and `error`
  - `off` shows none
- Add a focused settings-schema test for the new default mode.

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test apps/whispering/src/lib/query/toast-visibility.test.ts apps/whispering/src/lib/settings/settings.test.ts
```

Expected: failing assertions because the helper and settings key do not exist yet.

### Task 2: Implement Minimal Filtering

**Files:**
- Create: `apps/whispering/src/lib/query/toast-visibility.ts`
- Modify: `apps/whispering/src/lib/query/notify.ts`
- Modify: `apps/whispering/src/lib/settings/settings.ts`

**Step 1: Add the new setting**

- Add a new enumerated key for toast mode with default `all`.

**Step 2: Add the helper**

- Export a small pure function that takes toast mode + variant and returns whether the toast should render.

**Step 3: Wire the helper into notify**

- Keep dev logging, notification log writes, and OS notifications intact.
- Only gate the call to `services.toast.show(...)`.

**Step 4: Run tests to verify they pass**

Run:

```bash
bun test apps/whispering/src/lib/query/toast-visibility.test.ts apps/whispering/src/lib/settings/settings.test.ts
```

Expected: PASS

### Task 3: Add the General Settings UI

**Files:**
- Modify: `apps/whispering/src/routes/(app)/(config)/settings/+page.svelte`

**Step 1: Add the selector**

- Add a small radio/select UI in General settings for:
  - `All toasts`
  - `Important only`
  - `Off`

**Step 2: Keep user-facing copy concise**

- Frame it as controlling in-app toasts only.

**Step 3: Run app verification**

Run:

```bash
bun run --cwd apps/whispering typecheck
bun run --cwd apps/whispering build
```

Expected: both pass

### Task 4: Final Verification

**Files:**
- No new files

**Step 1: Run focused tests**

```bash
bun test apps/whispering/src/lib/query/toast-visibility.test.ts apps/whispering/src/lib/settings/settings.test.ts
```

**Step 2: Run app checks**

```bash
bun run --cwd apps/whispering typecheck
bun run --cwd apps/whispering build
git diff --check
```

**Step 3: Commit**

```bash
git add apps/whispering/src/lib/query/toast-visibility.ts \
  apps/whispering/src/lib/query/toast-visibility.test.ts \
  apps/whispering/src/lib/query/notify.ts \
  apps/whispering/src/lib/settings/settings.ts \
  apps/whispering/src/lib/settings/settings.test.ts \
  apps/whispering/src/routes/(app)/(config)/settings/+page.svelte \
  docs/plans/2026-03-13-toast-visibility-design.md \
  docs/plans/2026-03-13-toast-visibility.md
git commit -m "feat: add toast visibility controls"
```
