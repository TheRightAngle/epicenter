# Auth Transport Stabilization

Tighten the Better Auth transport seam without rewriting the auth stack.

The current issues are concentrated at the boundary between Better Auth, browser CORS, and the local auth/session wrapper:

- Browser clients cannot read `set-auth-token` cross-origin because the API does not expose the header.
- The Better Auth client captures rotated tokens but does not reuse them for subsequent requests.
- Session hydration assumes the token lives at the top level of the payload, which is narrower than Better Auth's `session.token` shape.
- `keyVersion` is produced by the API but is a larger follow-up because it affects the auth-to-workspace contract.

## Plan

- [x] Expose `set-auth-token` in the API CORS middleware.
- [x] Update `auth-transport.ts` to reuse rotated bearer tokens and read `session.token`.
- [x] Add focused JSDoc to the public auth transport API while the file is open.
- [x] Add direct transport tests for token rotation and nested session token hydration.
- [x] Run targeted Bun tests for `svelte-utils`.

## Scope Notes

Wave 1 is intentionally small:

- `apps/api/src/app.ts`
- `packages/svelte-utils/src/auth-transport.ts`
- `packages/svelte-utils/src/auth-transport.test.ts`

Deferred:

- Threading `keyVersion` through `SessionResolution`, `AuthRefreshResult`, and workspace boot.
- Reworking the `anonymous` vs `unchanged` policy into a richer error state.

## Review

Wave 1 landed as a transport correctness pass, not an auth rewrite.

Changes made:

- Added `exposeHeaders: ['set-auth-token']` to the API CORS middleware so browser clients can read rotated bearer tokens.
- Updated `createAuthTransport()` to:
  - reuse rotated bearer tokens immediately
  - treat an empty `set-auth-token` header as a token clear
  - read nested `session.token` from Better Auth session payloads
  - make remote sign-out idempotent for anonymous local sessions
- Added focused JSDoc to the public auth transport methods.
- Added direct `auth-transport` tests covering token rotation, header-clearing, and nested session token hydration.

Verification:

- `bun test packages/svelte-utils/src/auth-transport.test.ts packages/svelte-utils/src/workspace-auth.test.ts`
- `bun run --cwd packages/svelte-utils typecheck` still fails due pre-existing errors in `packages/workspace`, not from this auth transport wave

Deferred:

- Threading `keyVersion` through auth and workspace boot.
- Reworking `unchanged` into a richer error state.
