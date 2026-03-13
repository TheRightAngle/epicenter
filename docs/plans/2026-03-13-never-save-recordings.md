# Never-Save Recordings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `0 Recordings (Never Save)` skip recording persistence entirely while preserving transcription delivery and optional transformations.

**Architecture:** Add a small pure persistence-policy helper, flip the new-install defaults to the intended lightweight values, and branch the existing recording pipeline so the no-persist path uses `transformInput(...)` instead of the saved-recording path.

**Tech Stack:** Svelte 5, TypeScript, Bun test

---

### Task 1: Add the failing tests

**Files:**
- Create: `apps/whispering/src/lib/query/recording-persistence.test.ts`
- Modify: `apps/whispering/src/lib/settings/settings.test.ts`

**Step 1: Write the failing tests**

Cover:
- `limit-count + 0` disables recording persistence
- `limit-count + non-zero` still persists
- `keep-forever` still persists
- settings defaults are now `limit-count` and `0`

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test 'src/lib/query/recording-persistence.test.ts' 'src/lib/settings/settings.test.ts'
```

Expected: FAIL because the helper and new defaults do not exist yet.

### Task 2: Implement the persistence policy and pipeline branch

**Files:**
- Create: `apps/whispering/src/lib/query/recording-persistence.ts`
- Modify: `apps/whispering/src/lib/query/actions.ts`
- Modify: `apps/whispering/src/lib/settings/settings.ts`

**Step 1: Write the minimal implementation**

- add the pure `shouldPersistRecordings(...)` helper
- flip the new-install defaults for retention strategy and max count
- in `processRecordingPipeline(...)`, branch on the helper:
  - no-persist path skips `db.recordings.create(...)` and `db.recordings.update(...)`
  - no-persist transformation path uses `transformer.transformInput(...)`
  - persist path keeps current behavior

**Step 2: Run focused tests to verify they pass**

Run:

```bash
bun test 'src/lib/query/recording-persistence.test.ts' 'src/lib/settings/settings.test.ts'
```

Expected: PASS

### Task 3: Run the verification ring

**Files:**
- Verify only

**Step 1: Run focused verification**

Run:

```bash
bun test 'src/lib/query/recording-persistence.test.ts' 'src/lib/settings/settings.test.ts' 'src/lib/settings/output-fast-mode.test.ts' 'src/lib/settings/minimize-to-tray.test.ts'
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
