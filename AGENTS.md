# Epicenter

Local-first workspace platform. Monorepo with Yjs CRDTs and Svelte UI.

Structure: `apps/whispering/` (Tauri transcription app), `apps/tab-manager/` (Chrome extension), `apps/api/` (Cloudflare hub), `packages/workspace/` (core TypeScript/Yjs library), `packages/cli/` (published CLI package and `epicenter` binary), `packages/ui/` (shadcn-svelte components), `specs/` (planning docs), `docs/` (reference materials).

Always use bun: Prefer `bun` over npm, yarn, pnpm, and node. Use `bun run`, `bun test`, `bun install`, and `bun x` (instead of npx).

Destructive actions need approval: Force pushes, hard resets (`--hard`), branch deletions.

Token-efficient execution: When possible, delegate to sub-agent with only the command. Instruct it to execute without re-analyzing.

Writing conventions: Load `writing-voice` skill for any user-facing text—UI strings, tooltips, error messages, docs. Em dashes are always closed (no spaces).

Explanation conventions: For spec walkthroughs, architecture explanations, and API summaries, prefer the visual style from the `git` skill reference. Interleave short prose with concrete code snippets, before/after blocks, and ASCII diagrams. Avoid long prose-only explanations when code or structure is being discussed.
