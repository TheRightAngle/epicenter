# Hono JSX Auth Pages

Replace raw HTML exports with Hono JSX components for the API's auth-facing pages: sign-in, consent, and device authorization.

## Context

- **Better Auth does not serve login HTML.** The `oauthProvider` plugin redirects to `loginPage: '/sign-in'` and `consentPage: '/consent'`, but you render those pages yourself.
- **Sign-in flow**: Better Auth redirects to `/sign-in` with the original OAuth query params. After the user signs in (session created), Better Auth automatically continues the OAuth flow. The page just needs to be a working sign-in form.
- **Consent flow**: Better Auth redirects to `/consent` with `consent_code`, `client_id`, and `scope` query params. The page must POST to `/auth/oauth2/consent` with `{ accept: boolean, scope?: string, consent_code?: string }`.
- **Device flow** (`/device`): Already works via `device-page.ts` with raw HTML template literal. Will be migrated to JSX for consistency.
- **No Hono JSX usage exists** anywhere in the codebase yet. JSX is not configured in the API's tsconfig.
- **Existing auth form pattern**: `apps/tab-manager/src/lib/components/AuthForm.svelte` shows the UX: email/password fields, "Continue with Google" button, sign-in/sign-up toggle, error alerts. We replicate this behavior (not the Svelte code) in server-rendered HTML.

## Design Decisions

### Hono JSX over raw HTML
Structured components with a shared layout instead of template literals. Same output (HTML string), better DX.

### Hand-crafted CSS over Tailwind
The device page already achieves a clean shadcn-like aesthetic with ~20 lines of inline CSS (system-ui font, neutral grays, subtle borders, 8px radius). We extend this vocabulary into a shared style block in the layout. No Tailwind build step, no CDN script, no dependencies.

### No client-side hydration
These are forms. They submit via `fetch()` and show errors or redirect. Vanilla `<script>` blocks handle the interactivity, same as the existing device page. No `hono/jsx/dom`, no islands.

### `jsxRenderer` middleware for shared layout
Hono-idiomatic approach. All auth pages share the same `<html>`, `<head>`, CSS, and card wrapper.

## File Structure

```
apps/api/src/
  auth-pages/
    layout.tsx          # Shared HTML shell, <head>, CSS, card wrapper
    sign-in-page.tsx    # Email/password form + Google OAuth button
    consent-page.tsx    # OAuth consent screen (approve/deny)
    device-page.tsx     # Device code verification (migrated from device-page.ts)
    styles.ts           # Shared CSS string constant
  device-page.ts        # Deleted after migration
  app.ts                # Updated routes
```

## TSConfig Changes

`apps/api/tsconfig.json` needs JSX configured for Hono:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "types": ["@types/bun", "./worker-configuration.d.ts"]
  },
  "include": ["src", "env.d.ts"]
}
```

## Todo

### Setup
- [ ] Add `jsx: "react-jsx"` and `jsxImportSource: "hono/jsx"` to `apps/api/tsconfig.json`
- [ ] Create `apps/api/src/auth-pages/styles.ts` with shared CSS constants (extending the device-page aesthetic)

### Layout
- [ ] Create `apps/api/src/auth-pages/layout.tsx` -- shared `<html>`, `<head>`, viewport meta, CSS injection, centered card wrapper

### Sign-In Page
- [ ] Create `apps/api/src/auth-pages/sign-in-page.tsx` -- form with email/password fields, "Continue with Google" button, sign-in/sign-up toggle, error display. Form submits via `fetch()` to `/auth/sign-in/email` or `/auth/sign-up/email`. Google button navigates to `/auth/sign-in/social?provider=google&callbackURL={currentUrl}`. On success, reload the page (Better Auth auto-continues the OAuth flow when session exists).
- [ ] Wire `GET /sign-in` route in `app.ts` using the new JSX component

### Consent Page
- [ ] Create `apps/api/src/auth-pages/consent-page.tsx` -- shows which client is requesting access, requested scopes, approve/deny buttons. Reads `consent_code`, `client_id`, `scope` from query params. Approve/deny POST to `/auth/oauth2/consent` with `{ accept, scope, consent_code }`.
- [ ] Wire `GET /consent` route in `app.ts`

### Device Page Migration
- [ ] Create `apps/api/src/auth-pages/device-page.tsx` -- port existing `device-page.ts` logic to JSX, reusing the shared layout
- [ ] Update `/device` route in `app.ts` to use new JSX version
- [ ] Delete old `apps/api/src/device-page.ts`

### Verification
- [ ] Run `bun run typecheck` in `apps/api` to verify JSX compilation
- [ ] Manually verify the sign-in page renders correctly (if dev server available)

## Routes (final state in app.ts)

```tsx
import { SignInPage } from './auth-pages/sign-in-page';
import { ConsentPage } from './auth-pages/consent-page';
import { DevicePage } from './auth-pages/device-page';
import { AuthLayout } from './auth-pages/layout';

// Auth pages -- server-rendered JSX
app.get('/sign-in', (c) => c.html(<AuthLayout><SignInPage /></AuthLayout>));
app.get('/consent', (c) => {
  const consentCode = c.req.query('consent_code');
  const clientId = c.req.query('client_id');
  const scope = c.req.query('scope');
  return c.html(<AuthLayout><ConsentPage consentCode={consentCode} clientId={clientId} scope={scope} /></AuthLayout>);
});
app.get('/device', (c) => {
  const userCode = c.req.query('user_code');
  return c.html(<AuthLayout><DevicePage userCode={userCode} /></AuthLayout>);
});
```

## Sign-In Page Behavior

1. Page loads with email + password fields and a Google button
2. User can toggle between sign-in and sign-up (client-side JS swaps form action and labels)
3. Email/password submit: `fetch('/auth/sign-in/email', { method: 'POST', body: { email, password }, credentials: 'include' })`
4. On success: `window.location.reload()` -- Better Auth detects the session and continues the OAuth flow automatically
5. On error: display error message inline
6. Google button: navigates to `/auth/sign-in/social?provider=google&callbackURL={encodeURIComponent(window.location.href)}`

## Consent Page Behavior

1. Page loads showing the client name and requested scopes
2. Approve button: `fetch('/auth/oauth2/consent', { method: 'POST', body: { accept: true, consent_code, scope }, credentials: 'include' })`
3. Deny button: same endpoint with `accept: false`
4. On response: follow the redirect URL from the response

## Review

### Changes Made

**New files:**
- `apps/api/src/auth-pages/styles.ts` -- Shared CSS string constant (card, inputs, buttons, alerts, separators, scope list). Extends the device-page aesthetic: system-ui font, neutral grays, subtle borders, 8-12px radius.
- `apps/api/src/auth-pages/layout.tsx` -- Shared `AuthLayout` component rendering `<!DOCTYPE html>`, viewport meta, CSS injection via `<style>`, and centered card wrapper.
- `apps/api/src/auth-pages/sign-in-page.tsx` -- Sign-in/sign-up form with email+password fields, "Continue with Google" button, client-side mode toggle, error display. Submits via `fetch()` to `/auth/sign-in/email` or `/auth/sign-up/email`. On success, reloads page for Better Auth to continue the OAuth flow.
- `apps/api/src/auth-pages/consent-page.tsx` -- OAuth consent page showing client name, requested scopes, approve/deny buttons. POSTs to `/auth/oauth2/consent` with `{ accept, scope, consent_code }`.
- `apps/api/src/auth-pages/device-page.tsx` -- Direct port of `device-page.ts` to JSX. All behavior preserved (approve/deny, error states, prefilled user code).
- `apps/api/src/auth-pages/index.tsx` -- Render functions (`renderSignInPage`, `renderConsentPage`, `renderDevicePage`) that compose layout + page component. Keeps JSX in `.tsx` files so `app.ts` stays `.ts`.

**Modified files:**
- `apps/api/tsconfig.json` -- Added `jsx: "react-jsx"` and `jsxImportSource: "hono/jsx"`.
- `apps/api/src/app.ts` -- Replaced old `device-page` import with `auth-pages` render functions. Added `/sign-in` and `/consent` routes. Updated `/device` route to use JSX version.

**Deleted files:**
- `apps/api/src/device-page.ts` -- Replaced by `auth-pages/device-page.tsx`.

### Key Design Decision

Kept `app.ts` as a `.ts` file (not renamed to `.tsx`) because it's the wrangler entrypoint referenced by `wrangler.jsonc`, `package.json`, `worker-configuration.d.ts`, and `better-auth.config.ts`. Instead, JSX is fully contained in `auth-pages/*.tsx` and exposed via plain function exports in `auth-pages/index.tsx`.

### Verification

- `bun run typecheck` passes with zero errors.
- LSP diagnostics clean on all changed files.
