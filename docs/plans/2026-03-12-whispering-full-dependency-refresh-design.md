# Whispering Full Dependency Refresh Design

**Problem**

Whispering currently has dependency drift across three layers that matter to the desktop app:

- the Bun workspace catalog and frontend build stack
- app-local JavaScript SDKs and Tauri guest plugins
- Rust and Tauri native crates

The drift is already causing at least one real runtime defect. The Parakeet model download flow fails because the JavaScript side of `@tauri-apps/plugin-http` is out of sync with the native plugin protocol and still calls `fetch_read_body` without `streamChannel`.

The goal of this work is to refresh the app to current stable releases where possible, fix the compatibility fallout in one pass, and end with a clean Windows-capable unsigned release build on the fork.

**Approaches Considered**

1. Fix only the broken dependency mismatches.
   This is the lowest-risk path and would address the current model-download bug quickly, but it leaves the rest of the stack stale and does not satisfy the requirement to bring the app up to date.

2. Refresh dependencies in layers.
   This keeps the same end goal, but upgrades runtime, frontend, and service SDKs in separate waves with checkpoints between them. It is easier to debug, but it stretches the work across multiple partial states.

3. Do one big-bang refresh to latest stable across all three layers, then repair the fallout until the app is green again.
   This is the fastest route to a current stack, but it mixes multiple sources of breakage and requires a disciplined verification loop.

**Recommendation**

Take approach 3.

The user explicitly wants the app moved to current stable releases if possible, not just patched around a single failure. A big-bang refresh satisfies that requirement directly, while the verification gates keep the work bounded:

- local typecheck must pass
- local build must pass
- the Parakeet prebuilt-model download path must stop throwing the `streamChannel` error
- the unsigned fork release workflow must finish and publish Windows artifacts again

If a dependency cannot be brought to the absolute latest stable version without forcing a broken or high-risk workaround, stop at the highest compatible stable version and document the reason.

**Design**

**Scope**

- Update root workspace catalog versions in `package.json`.
- Update app-local JavaScript dependencies in `apps/whispering/package.json`.
- Update Rust and Tauri dependencies in `apps/whispering/src-tauri/Cargo.toml`.
- Regenerate `bun.lock` and `apps/whispering/src-tauri/Cargo.lock`.
- Keep product behavior intentionally unchanged unless a dependency upgrade requires a compatible adaptation.

**Execution Shape**

- First update the Bun workspace and app-local JavaScript manifests, then regenerate the lockfile.
- Next update the Rust and Tauri manifests, then regenerate the Cargo lockfile.
- After the dependency sweep, run verification and fix the compatibility fallout in place.
- When the branch is locally green again, push it and rerun the fork-safe unsigned release workflow on GitHub to validate a real Windows build path.

**Known Risk Areas**

- Tauri guest and native plugin compatibility, especially `@tauri-apps/plugin-http`
- Svelte, SvelteKit, Vite, and TypeScript version interactions
- Tauri crate and plugin API drift on the Rust side
- Service SDK interface changes for OpenAI, Anthropic, Groq, Google, Mistral, and ElevenLabs

**Guardrails**

- Use the existing feature worktree only. Do not touch the dirty main checkout.
- Prefer the smallest compatibility fix that preserves current behavior after the version bump.
- Keep the unsigned release workflow intact so fork builds stay usable during the refresh.

**Verification**

- `bun install`
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`
- focused check of the Parakeet download path to ensure the `streamChannel` runtime error is gone
- GitHub Actions run of the unsigned release workflow to confirm Windows artifacts are still produced
