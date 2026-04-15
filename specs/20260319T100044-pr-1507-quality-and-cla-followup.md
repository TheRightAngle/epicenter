# PR #1507 quality fixes and CLA workflow follow-up

## Goal

Make PR #1507 mergeable without bloating its scope.

## What I found

- PR #1507 has a small set of lint errors in files this branch already changed:
  - `apps/api/src/app.ts`
  - `packages/workspace/src/workspace/create-tables.ts`
  - `packages/workspace/src/workspace/define-table.ts`
  - `packages/workspace/src/workspace/types.ts`
- The CLA workflow is broken in `.github/workflows/ci.cla.yml` because it references `contributor-assistant/github-action@v2`, which GitHub Actions can no longer resolve.
- PR #1540 (`Initialize CLA signatures file`) only changes `signatures/cla.json` right now.
- The CLA workflow uses `pull_request_target`, which means the workflow definition comes from the base branch. Fixing `ci.cla.yml` on PR #1507 itself would not reliably unblock PR #1507 until that workflow fix is merged into `main`.

## Recommended branch strategy

1. Keep PR #1507 focused on its own code and attach only the minimal quality fixes required for files already in that branch.
2. Do **not** attach the CLA workflow fix to PR #1507.
3. Put the CLA workflow fix on the existing CLA bootstrap PR #1540, then retitle/reframe that PR so its scope becomes "bootstrap CLA enforcement" rather than only "initialize signatures file".
4. Merge the CLA bootstrap PR first, then re-run checks on PR #1507.

## Implementation plan

- [ ] Fix the non-null assertion in `apps/api/src/app.ts` with the smallest control-flow-safe guard.
- [ ] Convert the type-only import in `packages/workspace/src/workspace/create-tables.ts` to `import type`.
- [ ] Remove or rename the unused generic in `packages/workspace/src/workspace/define-table.ts` using the smallest type-safe change.
- [ ] Replace banned `{}` defaults/usages in `packages/workspace/src/workspace/define-table.ts` and `packages/workspace/src/workspace/types.ts` with a stricter empty-object type that matches intent.
- [ ] Run diagnostics on the changed TypeScript files.
- [ ] Run the repo quality command to verify whether branch-owned failures are resolved and note any remaining pre-existing failures.
- [ ] Update the CLA workflow on the CLA bootstrap branch/PR so it references a valid action version or commit SHA.
- [ ] Re-run or inspect CLA checks after the CLA workflow fix is merged or available on the base branch.

## Risks / notes

- If the CLA action repository/tag is gone entirely, the fix may require replacing the action, not just bumping the tag.
- Because `pull_request_target` evaluates from the base branch, the CLA fix must land on `main` before PR #1507 can benefit from it.
- Some current quality failures are unrelated repo noise and should not be fixed inside PR #1507 unless they are directly caused by this branch.

## Review

Pending implementation.
