# Whispering Never-Save Recordings Design

Repo: `/home/dev/projects/whispering/.worktrees/windows-dpi-resume-fix`
Branch: `codex/windows-dpi-resume-fix`
Date: 2026-03-13

## Goal

Make `0 Recordings (Never Save)` behave truthfully by skipping recording persistence entirely, while keeping transcription delivery and optional transformations working normally.

## Problem Summary

Whispering currently interprets `Keep Limited Number` plus `0 Recordings (Never Save)` as a retention cleanup rule instead of a persistence rule. The app still writes recording metadata and audio first, then later deletes those saved recordings during cleanup.

That creates a mismatch between the UI label and the real behavior:

- UI promise: never save recordings
- actual behavior: save then delete

It also adds unnecessary disk and database churn on the latency-sensitive recording path.

## Constraints

- Keep the fix small and local to the recording pipeline.
- Do not break fast transcription delivery.
- Do not disable transformations just because recording history is disabled.
- Preserve current behavior for all other retention settings.

## Approach Options

### Option 1: Pipeline branch based on a tiny persistence-policy helper

Add a small helper that decides whether recordings should be persisted from the current retention settings, then branch the recording pipeline accordingly.

Pros:

- Smallest real fix
- Easy to test
- Keeps retention cleanup unchanged for all non-zero cases

Cons:

- Adds one extra branch in the action pipeline

### Option 2: Push the behavior into DB services

Teach the DB layer to silently no-op `recordings.create(...)` when retention is zero.

Pros:

- Centralizes persistence policy in the storage layer

Cons:

- The DB layer does not currently know about live settings
- Makes the storage boundary more magical and harder to reason about

### Option 3: Keep save-then-delete but relabel the UI

Change the `0 Recordings (Never Save)` label to match the actual behavior.

Pros:

- Very low code change

Cons:

- Preserves unnecessary save/delete churn
- Does not actually fix the semantics bug

## Recommended Approach

Use Option 1.

Add a small pure helper that decides whether the current settings mean “persist recordings” or “skip recording history entirely.” Then branch the existing recording pipeline:

- persist path: keep the current save/update/transformRecording flow
- never-save path: skip `db.recordings.create(...)` and `db.recordings.update(...)`, still deliver the transcript, and run `transformInput(...)` if a transformation is selected

## Design Details

### Persistence Rule

Treat recording persistence as disabled only when:

- `database.recordingRetentionStrategy === 'limit-count'`
- `database.maxRecordingCount === '0'`

All other cases keep the current persistence behavior.

### Pipeline Behavior

When persistence is disabled:

- still transcribe the blob
- still deliver transcription output immediately
- do not create a recording row
- do not write the audio blob to recording history
- do not attempt to update recording status afterward
- if a transformation is selected, run `transformInput(...)` with the fresh transcript text

When persistence is enabled:

- keep the current create/update/transformRecording path

### Defaults

Also update the schema defaults for new installs to match the intended lightweight behavior:

- `database.recordingRetentionStrategy = 'limit-count'`
- `database.maxRecordingCount = '0'`

Existing installs with saved settings keep their current values because the settings system is migration-free and only applies defaults when keys are absent.

## Testing Strategy

Add a tiny pure helper with focused tests:

- returns `false` for `limit-count + 0`
- returns `true` for non-zero limit-count
- returns `true` for keep-forever

Also add a source-level test that locks in the new defaults in `settings.ts`.

Then run:

- focused tests for the new helper and settings defaults
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`
