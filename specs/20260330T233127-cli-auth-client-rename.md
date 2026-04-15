# CLI Auth Client Rename

**Date**: 2026-03-30
**Status**: Implemented
**Author**: OpenCode

## Overview

Rename the stale auth client identity from "Epicenter Runner" to a CLI-based name so the device authorization flow matches the current package and binary language.

## Motivation

### Current State

The API still registers the native auth client with the old runner wording:

```typescript
{
  clientId: 'epicenter-runner',
  name: 'Epicenter Runner',
  type: 'native',
}
```

The device page also tells users to enter the code shown by "Epicenter Runner".

This creates problems:

1. **Stale product language**: The auth flow exposes an old name even though the package is `@epicenter/cli` and the binary is `epicenter`.
2. **Split identity**: The machine id and the human-facing label describe the same client using different eras of naming.

### Desired State

The native auth client should use CLI-based naming consistently in API config, CLI requests, and device authorization UI copy.

## Research Findings

### Current auth naming path

| Location | Current value | Role |
| --- | --- | --- |
| `apps/api/src/auth/create-auth.ts` | `clientId: 'epicenter-runner'`, `name: 'Epicenter Runner'` | Trusted native OAuth client registration |
| `apps/api/src/auth-pages/device-page.tsx` | `Epicenter Runner` | User-facing device auth copy |
| `packages/cli/src/auth/api.ts` | `CLIENT_ID = 'epicenter-runner'` | CLI-side auth client id |
| `packages/cli/package.json` | `@epicenter/cli`, bin `epicenter` | Canonical package and binary naming |

**Key finding**: The stale name is hardcoded in the auth flow. It is not derived from package metadata.

**Implication**: A safe fix is a focused rename across the trusted client registration, matching CLI client id constant, and device auth UI copy.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Human-facing client name | `Epicenter CLI` | Matches the package concept directly and reads clearly in auth UI |
| Machine client id | `epicenter-cli` | Keeps id aligned with the current package identity |
| Scope | Auth flow only | Smallest change that fixes the mismatch without broader product renaming |

## Architecture

The same client identity appears in three places and must stay aligned.

```text
packages/cli/src/auth/api.ts
  clientId = epicenter-cli
          |
          v
apps/api/src/auth/create-auth.ts
  trusted client registration
  id = epicenter-cli
  name = Epicenter CLI
          |
          v
apps/api/src/auth-pages/device-page.tsx
  user sees "Epicenter CLI"
```

## Implementation Plan

### Phase 1: Rename auth client identity

- [x] Update the spec with final findings and review notes.
- [x] Rename the trusted client id and display name in `apps/api/src/auth/create-auth.ts`.
- [x] Rename the matching CLI client id in `packages/cli/src/auth/api.ts`.
- [x] Update the device authorization page copy in `apps/api/src/auth-pages/device-page.tsx`.
- [x] Run diagnostics on changed files and note any unrelated issues.

## Edge Cases

### Existing issued device codes

1. A device auth flow may have started before the rename.
2. The server may still have in-flight records tied to the old client id.
3. Expected outcome: new flows should use the new id; old in-flight state may need to expire naturally unless the server stores a stronger coupling elsewhere.

## Open Questions

1. **Should the client id keep the old value for backward compatibility while only changing the display name?**
   - Options: (a) rename both id and label, (b) rename label only
   - **Recommendation**: Rename both for consistency unless compatibility evidence shows active dependence on the old id.

## Success Criteria

- [x] The trusted native auth client uses CLI-based naming.
- [x] The device auth page no longer mentions "Epicenter Runner".
- [x] The CLI auth request uses the same client id registered by the API.
- [x] Diagnostics are clean on changed files or unrelated issues are documented.

## References

- `apps/api/src/auth/create-auth.ts` - Trusted client registration
- `apps/api/src/auth-pages/device-page.tsx` - Device auth copy
- `packages/cli/src/auth/api.ts` - CLI auth client id
- `packages/cli/package.json` - Package and binary naming

## Review

- Updated the trusted native auth client in `apps/api/src/auth/create-auth.ts` from `epicenter-runner` / `Epicenter Runner` to `epicenter-cli` / `Epicenter CLI`.
- Updated the CLI device auth client id in `packages/cli/src/auth/api.ts` to `epicenter-cli` so the client matches the API registration.
- Updated the device authorization copy in `apps/api/src/auth-pages/device-page.tsx` to tell users to use Epicenter CLI.
- Verified the edited files are free of language-server diagnostics.
- Verified there are no remaining `Epicenter Runner` or `epicenter-runner` matches in `apps/api` or `packages/cli`.
- Repo-wide validation is still blocked by pre-existing typecheck failures unrelated to this rename, including `apps/api/src/ai-chat.ts:69`, `apps/api/src/app.ts:591`, and existing errors under `packages/workspace`, `packages/sync-client`, and CLI test/runtime files.
