# Device token follow-up and stacked PR plan

## Goal

Verify whether the local `pollDeviceToken()` rewrite is the correct client behavior for Better Auth device authorization polling, finish the legitimate branch follow-up fixes, and package the branch into three chronological stacked PRs without rewriting commit history.

## Constraints

- Do not reorder or rewrite commits.
- Keep any code change as small as possible.
- Use evidence from Better Auth/source material before changing `pollDeviceToken()`.
- Only commit user-requested follow-up fixes.

## Todo

- [x] Verify `packages/cli/src/auth/api.ts` device token polling semantics against Better Auth and OAuth device flow behavior, with concrete evidence for whether 400 JSON error payloads should be returned instead of thrown.
- [x] Verify whether the uncommitted `packages/cli/src/commands/workspace-command.ts` import updates are a real follow-up fix caused by the CLI reorganization, not accidental drift.
- [x] If the `pollDeviceToken()` custom handling is justified, add detailed JSDoc explaining why this endpoint cannot use the generic request helper and how Better Auth/device polling semantics differ from normal API calls.
- [x] If the `workspace-command.ts` import fix is justified, keep the smallest correct import-path repair only.
- [x] Run focused validation for the touched CLI files and any minimal command needed to prove the follow-up fixes are sound.
- [ ] Stage and create small chronological commit(s) for the verified follow-up fixes only.
- [ ] Draft the exact 3 stacked PR sequence with base branch, commit range, title, summary, and reviewer guidance for each PR.

## Proposed stacked PR structure

### PR 1

- Base: `main`
- Range: `31be1bbf7` → `b5cab48a7`
- Theme: headless runner and device auth foundation

### PR 2

- Base: PR 1
- Range: `c574680a5` → `c28b20233`
- Theme: workspace architecture docs/spec consolidation

### PR 3

- Base: PR 2
- Range: `9b5848aa8` → `caf85bb62`
- Theme: auth pages, CLI consolidation, and follow-up refactors

## Review

- Better Auth device authorization and RFC 8628 both treat 400 JSON payloads like `authorization_pending` and `slow_down` as normal polling control flow, so `pollDeviceToken()` should not use the generic request helper that throws on every non-2xx response.
- `packages/cli/src/auth/api.ts` now keeps the dedicated fetch path, documents why it is special, and throws a clearer error when the token endpoint returns malformed JSON.
- `packages/cli/src/commands/workspace-command.ts` import updates are legitimate follow-up cleanup after the CLI reorganization moved discovery/config code into `config/` and shared helpers into `util/`.
- Validation: `lsp_diagnostics` reported no issues in the two touched CLI files. A direct `bun x tsc --noEmit ...` invocation surfaced broad pre-existing dependency/module-resolution errors outside these files, so it was not used as a signal against the local follow-up fixes.
