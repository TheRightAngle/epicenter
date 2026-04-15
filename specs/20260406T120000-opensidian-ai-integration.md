# Opensidian AI Integration

**Date**: 2026-04-06
**Status**: Implemented
**Author**: AI-assisted

## Overview

Add AI chat capabilities to opensidian, allowing users to interact with their notes through natural language. The AI operates on the same Yjs-backed virtual filesystem the editor and terminal already use. Two layers of skills customize AI behavior: **global skills** shared across all Epicenter apps (from `@epicenter/skills`), and **vault skills** personal to each user's note vault (from `/skills/*.md` files in the Yjs filesystem).

## Motivation

### Current State

Opensidian has a fully functional Yjs filesystem with bash shell integration:

```typescript
// apps/opensidian/src/lib/client.ts
export const fs = createYjsFileSystem(workspace.tables.files, workspace.documents.files.content);
export const bash = new Bash({ fs, cwd: '/' });
```

The tab-manager app already has a working TanStack AI chat integration with tool calling, approval flows, and multi-provider support—all connecting to the existing `/ai/chat` endpoint in `apps/api`.

The `@epicenter/skills` package provides a CRDT-backed skills workspace with `listSkills()`, `getSkill()`, and `getSkillWithReferences()` read actions. The `apps/skills` app already demonstrates this pattern with `createSkillsWorkspace()` + IndexedDB persistence.

### Problems

1. **No AI assistance**: Users can't ask questions about their notes, generate content, or organize files via natural language.
2. **Untapped infrastructure**: The `/ai/chat` endpoint, `@epicenter/ai` tool bridge, and workspace action system all exist but aren't wired into opensidian.
3. **No skill system**: No way for users to customize AI behavior, and no way for the platform to share ecosystem-wide skills with opensidian's AI.

### Desired State

A chat panel in opensidian where the AI can search, read, create, edit, and organize notes. Two skill layers shape AI behavior:

- **Global skills** from `@epicenter/skills`—platform-level behavior shared across all Epicenter apps (e.g. writing voice, documentation conventions, TypeScript patterns). Maintained by developers, synced via the skills workspace CRDT.
- **Vault skills** from `/skills/*.md`—user-created customizations personal to each vault (e.g. "format meeting notes like this", "use Spanish for responses"). Just markdown files the user edits like any other note.

All mutations require approval.

## Research Findings

### Existing Infrastructure (What We Reuse)

| Component | Location | What It Does |
|-----------|----------|-------------|
| `/ai/chat` endpoint | `apps/api/src/ai-chat.ts` | Hono handler: validates body (arktype), billing check, picks adapter, `chat()` → `toServerSentEventsResponse()` |
| `@epicenter/ai` tool bridge | `packages/ai/src/tool-bridge.ts` | `actionsToClientTools()` + `toToolDefinitions()` — converts workspace actions to TanStack AI tools |
| TanStack AI (Svelte) | `@tanstack/ai-svelte` | `createChat()` + `fetchServerSentEvents()` for SSE streaming |
| Chat UI components | `apps/tab-manager/src/lib/components/chat/` | `AiChat.svelte`, `MessageList.svelte`, `MessageParts.svelte`, `ToolCallPart.svelte`, `ToolResultPart.svelte`, `ChatInput.svelte` |
| Chat state pattern | `apps/tab-manager/src/lib/chat/chat-state.svelte.ts` | `createChat` wiring with tools, system prompts, persistence |
| Provider config | `apps/tab-manager/src/lib/chat/providers.ts` | `PROVIDER_MODELS` map, `DEFAULT_PROVIDER`/`DEFAULT_MODEL` |
| Tool trust state | `apps/tab-manager/src/lib/state/tool-trust.svelte.ts` | Auto-approve logic for trusted tools |
| Workspace actions | `apps/tab-manager/src/lib/client.ts` | `withActions()` with `defineMutation`/`defineQuery` pattern |
| just-bash | `apps/opensidian/src/lib/client.ts` | Already wired: `new Bash({ fs, cwd: '/' })` with Yjs filesystem |
| SQLite FTS search | `apps/opensidian/src/lib/state/search-state.svelte.ts` | `workspace.extensions.sqliteIndex.search()` |
| Skills workspace | `packages/skills/src/workspace.ts` | `createSkillsWorkspace()` with `listSkills()`, `getSkill()`, `getSkillWithReferences()` read actions |
| Skills tables | `packages/skills/src/tables.ts` | `skillsTable` + `referencesTable` — CRDT-backed skill storage with Y.Doc instructions |
| Skills app pattern | `apps/skills/src/lib/client.ts` | Example: `createSkillsWorkspace().withExtension('persistence', indexeddbPersistence)` |

**Key finding**: The server endpoint needs zero changes. It already accepts `tools` and `systemPrompts` in the request body and passes them through to `chat()`.

### Tab-Manager Chat Architecture (Pattern to Follow)

```
Browser                                          Server (apps/api)
───────                                          ─────────────────
workspace.withActions(defineMutation/Query)
    │
    ▼
actionsToClientTools(workspace.actions)
    │
    ├──► workspaceTools    (client-side, with execute fns)
    └──► workspaceDefinitions (wire-safe, no execute)
            │
            ▼
createChat({
  tools: workspaceTools,          ◄── client auto-executes
  connection: fetchServerSentEvents(
    '/ai/chat',
    { body: { data: {
        provider, model,
        systemPrompts: [...],
        tools: workspaceDefinitions  ◄── server sees these
    }}}
  )
})
    │                                     │
    │◄──── SSE stream ────────────────────┤
    │  tool-call → approval UI            │
    │  text → message bubble              │
    │  tool-result → result display       │
```

### Two-Layer Skill Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    System Prompt Composition                     │
│                                                                  │
│  Layer 1: Base Prompt (hardcoded)                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ "You are an AI assistant for Opensidian..."                │  │
│  │ Capabilities, constraints, file path conventions           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Layer 2: Global Skills (from @epicenter/skills workspace)       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Source: packages/skills → CRDT table → listSkills/getSkill │  │
│  │ Scope:  Shared across ALL Epicenter apps                   │  │
│  │ Who:    Developers / platform maintainers                  │  │
│  │ Examples: writing-voice, typescript, documentation          │  │
│  │ Editable by user: No (shipped with platform)               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Layer 3: Vault Skills (from /skills/*.md in Yjs filesystem)     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Source: User's Yjs filesystem (fs.readdir + fs.readFile)   │  │
│  │ Scope:  Personal to each user's vault                      │  │
│  │ Who:    The user                                           │  │
│  │ Examples: "format meetings like X", "respond in Spanish"   │  │
│  │ Editable by user: Yes (they're just notes)                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Why two layers, not one:**

- **Global skills** define ecosystem-wide behavior. When the writing-voice skill is updated in `packages/skills`, every Epicenter app's AI improves. These are curated, version-controlled, and synced via the skills workspace CRDT. They're the same skills tab-manager's AI would use.
- **Vault skills** are personal. A researcher's vault skills differ from a developer's. They live in the filesystem because opensidian is a note-taking app—everything is a note. Users edit them alongside their other files.
- **Neither replaces the other.** Global skills provide a consistent baseline; vault skills add personal customization on top. The system prompt concatenates both.

**How global skills are loaded:**

```typescript
// Separate workspace instance for skills (same pattern as apps/skills)
import { createSkillsWorkspace } from '@epicenter/skills';

const skillsWorkspace = createSkillsWorkspace()
  .withExtension('persistence', indexeddbPersistence);

// At chat init: read all global skills
const globalSkills = skillsWorkspace.actions.listSkills();
const fullSkills = await Promise.all(
  globalSkills.map(s => skillsWorkspace.actions.getSkill({ id: s.id }))
);
```

**How vault skills are loaded:**

```typescript
// Read from the user's Yjs filesystem
const entries = await fs.readdir('/skills');
const vaultSkills = await Promise.all(
  entries.filter(e => e.endsWith('.md')).map(async entry => ({
    name: entry.replace('.md', ''),
    content: await fs.readFile(`/skills/${entry}`),
  }))
);
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool model | Hybrid (structured tools + bash) | Structured tools for common ops with approval gating. Bash tool for power-user file manipulation. Both operate on the same Yjs fs |
| Skill architecture | Two layers: global (`@epicenter/skills`) + vault (`/skills/*.md`) | Global skills are ecosystem-wide platform behavior. Vault skills are user customizations. Neither replaces the other |
| Global skill source | `@epicenter/skills` workspace (CRDT table) | Already exists, syncs across devices, used by other apps. Separate workspace instance with IndexedDB persistence |
| Vault skill source | `/skills/*.md` files in Yjs filesystem | Opensidian is a note-taking app—user skills should be notes users can edit |
| Skill loading | Load all from both layers at chat init | Simple for v1. LLM-based selection can come later |
| Skill prompt order | Base → Global → Vault | Vault skills override global when they conflict (later instructions win in LLM context) |
| Chat UI placement | Resizable side panel (right side) | Terminal stays at bottom for bash. Chat is a different interaction mode |
| Server changes | None | `/ai/chat` already handles everything we need |
| Chat components | Copy from tab-manager, adapt | Same TanStack AI integration, different tool set |
| Approval model | All mutations need approval, queries auto-execute | Matches tab-manager pattern via `defineMutation` vs `defineQuery` |
| Bash tool | Single tool, always needs approval | Bash can do anything—always gate it |
| Chat persistence | Store messages in workspace CRDT table | Same pattern as tab-manager: `chatMessages` table + `conversations` table |
| Provider/model selection | Reuse tab-manager's provider config | Same providers, same models, same billing |

## Architecture

### New Files

```
apps/opensidian/src/lib/
  chat/                          ← NEW module
    chat-state.svelte.ts         ← createChat + SSE + tool wiring
    system-prompt.ts             ← base prompt + skill prompt builders (global + vault)
    providers.ts                 ← copy from tab-manager (provider/model lists)
    ui-message.ts                ← convert persisted messages ↔ UIMessage
  state/
    skill-state.svelte.ts        ← two-layer skill loader (global + vault)
  workspace/
    definition.ts                ← ADD: chatMessages + conversations tables
  components/
    chat/                        ← NEW UI module
      AiChat.svelte              ← top-level chat composition
      MessageList.svelte         ← message rendering + typing indicator
      MessageParts.svelte        ← text / tool-call / tool-result / thinking
      ToolCallPart.svelte        ← approval UI (Allow / Always Allow / Deny)
      ToolResultPart.svelte      ← tool result display
      ChatInput.svelte           ← input + model selector + send/stop
    AppShell.svelte              ← MODIFY: add chat panel (resizable)
  client.ts                      ← MODIFY: add .withActions(), skills workspace, tool exports
```

### Data Flow

```
User types message
    │
    ▼
ChatInput.svelte → chat.sendMessage({ content })
    │
    ▼
chat-state.svelte.ts (createChat)
    ├─ persists user message to workspace.tables.chatMessages
    ├─ sends to /ai/chat via fetchServerSentEvents
    │   body: { messages, data: { provider, model, systemPrompts, tools } }
    │
    ▼
Server: chat({ adapter, messages, tools, systemPrompts })
    │
    ▼ SSE stream back
    │
    ├─ TEXT_MESSAGE_CONTENT → append to message bubble
    ├─ TOOL_CALL_START → show tool call UI
    │   ├─ Query (files_search, files_read, files_list)
    │   │   → auto-execute via client tool
    │   └─ Mutation (files_write, files_delete, bash)
    │       → show approval UI (Allow / Always Allow / Deny)
    ├─ TOOL_CALL_END → show result
    └─ RUN_FINISHED → persist assistant message
```

### Workspace Actions (Tools the AI Gets)

```
workspace.withActions(({ tables }) => ({
  files: {
    search:  defineQuery     → sqliteIndex.search(query)
    read:    defineQuery     → fs.readFile(path)
    list:    defineQuery     → fs.readdir(path)
    write:   defineMutation  → fs.writeFile(path, content)  [approval]
    create:  defineMutation  → fs.writeFile(path, '')       [approval]
    delete:  defineMutation  → fs.rm(path)                  [approval]
    move:    defineMutation  → fs.mv(src, dst)              [approval]
    mkdir:   defineMutation  → fs.mkdir(path)               [approval]
  },
  bash: {
    exec:    defineMutation  → bash.exec(command)           [approval]
  },
}))
```

### System Prompt Composition

```
systemPrompts: [
  OPENSIDIAN_SYSTEM_PROMPT,              ← Layer 1: base role + capabilities + constraints
  buildGlobalSkillsPrompt(globalSkills), ← Layer 2: @epicenter/skills ecosystem skills
  buildVaultSkillsPrompt(vaultSkills),   ← Layer 3: /skills/*.md user customizations
]
```

Each builder produces a clearly labeled section so the AI knows the source:

```markdown
## Global Skills (Epicenter Platform)

These skills define ecosystem-wide conventions shared across all Epicenter apps.

### writing-voice
[instructions from @epicenter/skills]

### documentation
[instructions from @epicenter/skills]

---

## Vault Skills (User Customizations)

These skills are personal to this vault. The user created and maintains them.

### meeting-notes
[content from /skills/meeting-notes.md]

### spanish-responses
[content from /skills/spanish-responses.md]
```

## Implementation Plan

### Phase 1: Workspace Schema + Actions + Dependencies

- [x] **1.1** Add `chatMessages` and `conversations` tables to `apps/opensidian/src/lib/workspace/definition.ts` (copy schema pattern from tab-manager's definition.ts)
- [x] **1.2** Add `.withActions()` to workspace chain in `client.ts` defining file operation tools (search, read, list, write, create, delete, move, mkdir) and bash exec
- [x] **1.3** Export `workspaceTools` and `workspaceDefinitions` from `client.ts` via `actionsToClientTools` + `toToolDefinitions`
- [x] **1.4** Create a skills workspace instance in `client.ts`: `createSkillsWorkspace().withExtension('persistence', indexeddbPersistence)` — separate from the main opensidian workspace
- [x] **1.5** Add `@epicenter/ai`, `@epicenter/skills`, `@tanstack/ai`, `@tanstack/ai-svelte`, `@tanstack/ai-client` to opensidian's package.json dependencies

### Phase 2: Skills + System Prompt + Chat State

- [x] **2.1** Create `chat/providers.ts` — copy provider/model config from tab-manager
- [x] **2.2** Create `chat/system-prompt.ts` with three clearly documented builders:
  - `OPENSIDIAN_SYSTEM_PROMPT` — base role, capabilities, constraints
  - `buildGlobalSkillsPrompt(skills)` — formats global skills from `@epicenter/skills` with header explaining their ecosystem-wide scope
  - `buildVaultSkillsPrompt(skills)` — formats vault skills from `/skills/*.md` with header explaining their user-personal scope
  - JSDoc on each explaining the layer hierarchy and why both exist
- [x] **2.3** Create `state/skill-state.svelte.ts` — two-layer skill loader:
  - `loadGlobalSkills()` — calls `skillsWorkspace.actions.listSkills()` then `getSkill()` for each
  - `loadVaultSkills()` — reads `/skills/*.md` from Yjs filesystem
  - `loadAllSkills()` — calls both, exposes `globalSkills` and `vaultSkills` as separate reactive arrays
  - JSDoc explaining the two-layer architecture, why they're separate, and how they compose
- [x] **2.4** Create `chat/ui-message.ts` — convert between persisted chat messages and TanStack `UIMessage` (adapt from tab-manager)
- [x] **2.5** Create `chat/chat-state.svelte.ts` — `createChat` + `fetchServerSentEvents` wiring with tools, system prompts (all three layers), message persistence, tool approval/deny methods

### Phase 3: Chat UI Components

- [x] **3.1** Create `components/chat/ChatInput.svelte` — text input, model selector dropdown, send/stop buttons
- [x] **3.2** Create `components/chat/MessageParts.svelte` — render text, tool-call, tool-result, thinking parts
- [x] **3.3** Create `components/chat/ToolCallPart.svelte` — approval UI (Allow / Always Allow / Deny) with auto-approve from tool trust state
- [x] **3.4** Create `components/chat/ToolResultPart.svelte` — result display with streaming/error states
- [x] **3.5** Create `components/chat/MessageList.svelte` — scrollable message list with typing indicator
- [x] **3.6** Create `components/chat/AiChat.svelte` — top-level composition wiring chat state to UI components

### Phase 4: Shell Integration + Layout

- [x] **4.1** Add resizable chat panel to `AppShell.svelte` (right side, togglable)
- [x] **4.2** Add chat toggle button to `Toolbar.svelte`
- [x] **4.3** Wire keyboard shortcut to toggle chat panel (Cmd+Shift+L)
- [ ] **4.4** Create a default `/skills/` folder with a sample vault skill file on first load (deferred — users can create their own)

## Edge Cases

### No `/skills/` Directory

1. User has no `/skills/` folder in their vault
2. `skill-state.svelte.ts` catches the readdir error
3. Returns empty vault skills array — chat works fine with only global skills (or no skills at all)

### No Global Skills Available

1. Skills workspace has no skills synced yet (fresh install, no persistence)
2. `listSkills()` returns empty array
3. Chat works fine with only vault skills (or no skills at all)

### Offline / No API Connection

1. User is offline or API unreachable
2. `fetchServerSentEvents` fetch fails
3. `onError` callback fires, error displayed in chat UI
4. No data loss — user messages are persisted locally before sending

### Large File Content in Tool Results

1. AI calls `files_read` on a very large file
2. Tool result could be enormous
3. Truncate read content to reasonable limit (e.g. 50KB) with a note: "Content truncated. Use bash `head`/`tail` for specific sections."

### Concurrent Edits During AI Write

1. AI writes to a file via `files_write`
2. User is editing the same file in the editor
3. Yjs CRDT handles merge automatically — this is the whole point of the architecture
4. Both changes survive

### Bash Command That Hangs

1. AI calls `bash.exec()` with a command that doesn't terminate
2. just-bash has built-in execution limits
3. Returns with error exit code + stderr message

### Vault Skill Conflicts with Global Skill

1. User creates `/skills/writing-voice.md` that conflicts with the global `writing-voice` skill
2. Both are injected — vault skill appears later in the prompt, so the LLM prioritizes it
3. This is intentional: users can override platform defaults

## Open Questions

1. **Should the chat panel persist conversation across sessions?**
   - Options: (a) Yes, restore last conversation on app load, (b) No, always start fresh, (c) User chooses
   - **Recommendation**: (a) Yes — same as tab-manager. Messages are in the CRDT table, just reload them.

2. **Should we add context about the currently open file to the system prompt?**
   - e.g. "The user currently has `/notes/meeting.md` open in the editor"
   - **Recommendation**: Yes in a future phase. For v1, the AI can ask or the user can mention it.

3. **Should vault skills support frontmatter metadata (like `.agents/skills/` SKILL.md format)?**
   - e.g. `description` field for skill selection later
   - **Recommendation**: Defer. Plain markdown for v1. Add YAML frontmatter when we add LLM-based skill selection.

4. **Multiple conversations or single thread?**
   - **Recommendation**: Single conversation for v1. Add conversation management (new/switch/delete) in a follow-up.

5. **Should global skills sync from the API, or rely on IndexedDB persistence from prior imports?**
   - **Recommendation**: IndexedDB persistence only for v1. The skills workspace persists locally. If the user has used the skills app or CLI to import skills, they're already available. Future: add sync extension to the skills workspace.

## Success Criteria

- [ ] User can open a chat panel in opensidian
- [ ] User can send a message and receive a streamed AI response
- [ ] AI can search notes via FTS (auto-executes, no approval needed)
- [ ] AI can read file content (auto-executes)
- [ ] AI can write/create/delete/move files (requires user approval)
- [ ] AI can execute bash commands (requires user approval)
- [ ] Global skills from `@epicenter/skills` are loaded and injected into the system prompt
- [ ] Vault skills from `/skills/*.md` are loaded and injected into the system prompt
- [ ] Both skill layers are clearly labeled in the system prompt so the AI knows their scope
- [ ] Chat messages persist across page reloads
- [ ] Model/provider can be selected from the chat UI
- [ ] No changes needed to `apps/api`
- [ ] All new code has JSDoc explaining the skill architecture and layer hierarchy

## References

- `apps/opensidian/src/lib/client.ts` — workspace + fs + bash setup (modify: add withActions + skills workspace)
- `apps/opensidian/src/lib/workspace/definition.ts` — workspace schema (modify: add chat tables)
- `apps/opensidian/src/lib/components/AppShell.svelte` — main layout (modify: add chat panel)
- `apps/opensidian/src/lib/components/Toolbar.svelte` — toolbar (modify: add chat toggle)
- `apps/opensidian/src/lib/state/search-state.svelte.ts` — FTS search pattern to follow
- `apps/tab-manager/src/lib/chat/chat-state.svelte.ts` — chat state pattern to adapt
- `apps/tab-manager/src/lib/chat/providers.ts` — provider config to copy
- `apps/tab-manager/src/lib/chat/system-prompt.ts` — system prompt pattern
- `apps/tab-manager/src/lib/chat/ui-message.ts` — message conversion pattern
- `apps/tab-manager/src/lib/components/chat/` — all chat UI components to adapt
- `apps/tab-manager/src/lib/state/tool-trust.svelte.ts` — tool trust pattern to copy
- `packages/ai/src/tool-bridge.ts` — `actionsToClientTools` + `toToolDefinitions`
- `packages/skills/src/workspace.ts` — `createSkillsWorkspace()` with read actions (global skills source)
- `packages/skills/src/tables.ts` — skills + references CRDT table definitions
- `packages/skills/src/definition.ts` — `epicenter.skills` workspace definition
- `apps/skills/src/lib/client.ts` — reference pattern for skills workspace setup
- `apps/skills/src/lib/state/skills-state.svelte.ts` — reference pattern for reactive skills state
- `apps/api/src/ai-chat.ts` — server endpoint (no changes needed)

## Review

**Completed**: 2026-04-06

### Summary

Added AI chat to opensidian with a two-layer skill architecture (global platform skills + user vault skills). The implementation reuses the existing `/ai/chat` server endpoint, `@epicenter/ai` tool bridge, and TanStack AI Svelte integration from the tab-manager. No server changes needed. The AI can search, read, create, edit, delete, and move files in the Yjs filesystem, and execute bash commands against the virtual shell. All mutations require user approval; queries auto-execute.

### What Was Built

**15 new/modified files:**
- `workspace/definition.ts` -- added conversations, chatMessages, toolTrust tables with branded IDs
- `client.ts` -- added withActions (9 file/bash tools), skills workspace, tool bridge exports
- `chat/providers.ts` -- provider/model config (OpenAI, Anthropic, Gemini, Grok)
- `chat/system-prompt.ts` -- 3-layer prompt: base + global skills + vault skills
- `chat/ui-message.ts` -- CRDT to UIMessage conversion boundary
- `chat/chat-state.svelte.ts` -- reactive chat state with createChat, SSE, persistence
- `state/skill-state.svelte.ts` -- two-layer skill loader (global + vault)
- 6 Svelte components: AiChat, ChatInput, MessageList, MessageParts, ToolCallPart, ToolResultPart
- `package.json` -- added @epicenter/ai, @epicenter/skills, @tanstack/ai-* dependencies
- `AppShell.svelte` -- resizable chat panel (right side, Cmd+Shift+L toggle)
- `Toolbar.svelte` -- AI Chat toggle button with active state indicator

### Deviations from Spec

- **4.4 deferred**: Default `/skills/` folder with sample skill not created. Users can create their own.
- **No tool trust state**: Simplified from tab-manager. Always shows approval UI for mutations. Can add in follow-up.
- **No markdown rendering**: MessageParts renders text as plain whitespace-pre-wrap. marked/dompurify not in deps.
- **client.ts restructured**: Used buildWorkspaceClient() function to avoid circular type inference.

### Follow-up Work

- Add marked + dompurify for markdown rendering in chat messages
- Add tool trust state for auto-approve persistence
- Add active file context to system prompt
- Add conversation management UI (new/switch/delete)
- Add sync extension to skills workspace for cross-device skill sync
- Add default /skills/writing-assistant.md sample file on first vault creation
