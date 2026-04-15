# Skills Editor

A local editor for writing the prompt files and configuration that power Epicenter agents. It uses Yjs CRDTs under the hood—so undo/redo works across sessions and the format is ready for collaboration—but it doesn't sync anywhere. Your skills stay on your machine.

Part of the [Epicenter](https://github.com/EpicenterHQ/epicenter) monorepo. MIT licensed.

---

## How it works

### What's a skill?

A skill is a set of instructions (markdown) plus reference files that tell an Epicenter agent how to perform a specific task. Each skill has metadata (name, description, license, compatibility) and one or more reference documents. The Skills Editor is where you author and organize these.

### Workspace connection

The app imports `createSkillsWorkspace` from `@epicenter/skills`, which provides two tables: `skills` (metadata + attached instructions document) and `references` (per-skill reference files, each with its own content document). The workspace ID is `epicenter.skills`. Persistence is IndexedDB—no remote sync is wired in, so the editor works entirely offline.

### Collaborative editing

Each skill's instructions and each reference's content are `Y.Doc`-backed documents. CodeMirror 6 with `y-codemirror.next` binds directly to those documents, so edits are conflict-free and survive concurrent sessions.

### UI

A single route renders a resizable split view: sidebar on the left, editor panel on the right.

- **Sidebar**—skill list with search, keyboard navigation (arrow keys), inline rename (F2), and delete with confirmation.
- **Editor panel**—metadata form (name, description, license, compatibility), instructions editor (CodeMirror + Yjs), and a references panel with expandable entries, each with its own CodeMirror editor.
- **Command palette**—search across skills from anywhere.

---

## Workspace schema

Workspace ID: `epicenter.skills`

| Table | Columns | Attached doc |
|---|---|---|
| `skills` | `id`, `name`, `description`, `license`, `compatibility` | `instructions` (Y.Doc) |
| `references` | `id`, `skillId`, `name` | `content` (Y.Doc) |

---

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
git clone https://github.com/EpicenterHQ/epicenter.git
cd epicenter
bun install
cd apps/skills
bun dev
```

---

## Tech stack

- [SvelteKit](https://kit.svelte.dev)—UI framework (SSR disabled)
- [CodeMirror 6](https://codemirror.net) + [y-codemirror.next](https://github.com/yjs/y-codemirror.next)—collaborative markdown editing
- [Yjs](https://yjs.dev)—CRDT engine
- [Tailwind CSS](https://tailwindcss.com)—styling
- `@epicenter/skills`—workspace definition for skills and references
- `@epicenter/workspace`—CRDT-backed tables, persistence
- `@epicenter/svelte`—reactive table bindings
- `@epicenter/ui`—shadcn-svelte component library

---

## License

MIT
