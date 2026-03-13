# Recording Device Label Disambiguation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ambiguous microphone labels in Whispering’s recording settings readable without changing device selection behavior.

**Architecture:** Add one shared pure utility that rewrites only duplicate display labels. Use it in the manual recorder query and VAD enumeration path, optionally borrowing richer navigator labels on desktop when they are available.

**Tech Stack:** Bun test, TypeScript, Svelte query layer, Tauri desktop environment

---

### Task 1: Add a pure duplicate-label disambiguation utility

**Files:**
- Create: `apps/whispering/src/lib/services/device-labels.ts`
- Test: `apps/whispering/src/lib/services/device-labels.test.ts`

**Step 1: Write the failing test**

Add tests for:
- unique labels remain unchanged
- duplicate labels use richer detail labels when available
- duplicate labels fall back to numbered suffixes when no detail exists

**Step 2: Run test to verify it fails**

Run: `bun test apps/whispering/src/lib/services/device-labels.test.ts`
Expected: FAIL because the utility file does not exist yet.

**Step 3: Write minimal implementation**

Implement a pure helper that:
- groups devices by visible label
- leaves unique labels alone
- derives detail text from a parallel richer label list when possible
- otherwise appends deterministic numbering

**Step 4: Run test to verify it passes**

Run: `bun test apps/whispering/src/lib/services/device-labels.test.ts`
Expected: PASS

### Task 2: Apply the helper to manual recorder device enumeration

**Files:**
- Modify: `apps/whispering/src/lib/query/recorder.ts`
- Reuse: `apps/whispering/src/lib/services/device-labels.ts`

**Step 1: Write the failing test**

Add a focused recorder query test that proves duplicate backend labels become disambiguated while IDs stay unchanged.

**Step 2: Run test to verify it fails**

Run: `bun test apps/whispering/src/lib/query/recorder.test.ts`
Expected: FAIL because recorder enumeration still returns raw duplicate labels.

**Step 3: Write minimal implementation**

In the recorder enumerate query:
- get the selected recorder service devices
- on desktop, try navigator enumeration as an optional detail source
- pass both lists through the helper
- return the same IDs with improved labels

**Step 4: Run test to verify it passes**

Run: `bun test apps/whispering/src/lib/query/recorder.test.ts`
Expected: PASS

### Task 3: Apply the helper to VAD device enumeration

**Files:**
- Modify: `apps/whispering/src/lib/state/vad-recorder.svelte.ts`
- Reuse: `apps/whispering/src/lib/services/device-labels.ts`

**Step 1: Write the failing test**

Add a focused unit test for the utility-driven VAD path if a dedicated VAD test is warranted. If the pure utility already covers the label behavior, skip extra test creation here.

**Step 2: Run the relevant test set**

Run: `bun test apps/whispering/src/lib/services/device-labels.test.ts`
Expected: PASS and continue with minimal integration code.

**Step 3: Write minimal implementation**

Apply the same helper to navigator/VAD enumeration so duplicate labels are disambiguated there too.

**Step 4: Re-run the relevant tests**

Run: `bun test apps/whispering/src/lib/services/device-labels.test.ts`
Expected: PASS

### Task 4: Verify end-to-end code health

**Files:**
- Verify: `apps/whispering/src/lib/services/device-labels.ts`
- Verify: `apps/whispering/src/lib/query/recorder.ts`
- Verify: `apps/whispering/src/lib/state/vad-recorder.svelte.ts`

**Step 1: Run focused tests**

Run:
- `bun test apps/whispering/src/lib/services/device-labels.test.ts`
- `bun test apps/whispering/src/lib/query/recorder.test.ts`

Expected: PASS

**Step 2: Run app verification**

Run:
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/whispering/src/lib/services/device-labels.ts \
  apps/whispering/src/lib/services/device-labels.test.ts \
  apps/whispering/src/lib/query/recorder.ts \
  apps/whispering/src/lib/query/recorder.test.ts \
  apps/whispering/src/lib/state/vad-recorder.svelte.ts \
  docs/plans/2026-03-13-recording-device-label-disambiguation-design.md \
  docs/plans/2026-03-13-recording-device-label-disambiguation.md
git commit -m "feat: disambiguate recording device labels"
```
