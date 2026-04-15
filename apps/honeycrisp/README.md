# Honeycrisp

Honeycrisp is a notes app that works offline first and syncs when it can. Notes, folders, and rich text are all Yjs CRDTs—two devices can edit the same note simultaneously and converge without conflicts. Open two browser tabs and try it.

Part of the [Epicenter](https://github.com/EpicenterHQ/epicenter) monorepo. MIT licensed.

---

## How it works

### Layout

Single-route SvelteKit app with a three-pane layout: sidebar (folders) → note list → editor. SSR is disabled; the app runs entirely in the browser as a static site.

### Data layer

All state lives in an Epicenter workspace (`id: "epicenter.honeycrisp"`). The workspace is created once on startup, wired to IndexedDB for local persistence, and connected to a WebSocket server for real-time sync. Auth tokens and encryption keys are applied at login before any data is read or written.

### Rich-text editing

Each note's body is a `Y.XmlFragment` stored as an attached document on the `notes` table. ProseMirror binds to it via `y-prosemirror`, giving collaborative editing for free. The editor schema covers paragraphs, headings, lists, task lists, underline, and strikethrough. Every ProseMirror transaction extracts a title, preview snippet, and word count, which are written back to the note's table row.

### Soft deletion

Notes are never removed from the CRDT—they're soft-deleted with a `deletedAt` timestamp. This matters when two devices diverge: one deletes a note while the other keeps editing it. Without soft deletion, the CRDT has no way to represent "deleted but also modified." With it, you can restore the note and keep the edits. Soft-deleted notes appear in "Recently Deleted" where you can restore or permanently remove them.

### Auth

Google sign-in via `@epicenter/svelte/auth-form`. The session is persisted across reloads. Encryption keys are applied on login before the workspace connects.

---

## Workspace schema

**Workspace ID:** `epicenter.honeycrisp`

### Tables

**`folders`**
| Field | Type |
|---|---|
| `id` | `FolderId` |
| `name` | `string` |
| `icon` | `string` (optional) |
| `sortOrder` | `number` |
| `_v` | version |

**`notes`** (v2, migrated from v1)
| Field | Type |
|---|---|
| `id` | `NoteId` |
| `folderId` | `FolderId` (optional) |
| `title` | `string` |
| `preview` | `string` |
| `pinned` | `boolean` |
| `createdAt` | `number` |
| `updatedAt` | `number` |
| `deletedAt` | `number` (optional, soft delete) |
| `wordCount` | `number` (optional) |

Each note has an attached document: `withDocument('body', { guid: 'id', onUpdate })` → `Y.XmlFragment`.

The v1→v2 migration adds `deletedAt` and `wordCount`.

### KV

| Key | Type |
|---|---|
| `selectedFolderId` | `FolderId` |
| `selectedNoteId` | `NoteId` |
| `sortBy` | `'dateEdited' \| 'dateCreated' \| 'title'` |

---

## Other features

- **Pin/unpin**—pinned notes sort to the top of the list.
- **Folder deletion**—re-parents all notes in the folder to unfiled, keeping data intact.
- **Sorting**—by date edited, date created, or title.
- **Search**—filters by title and preview content.
- **Keyboard shortcuts**—`Cmd+N` (new note), `Cmd+Shift+N` (new folder).
- **Context menus**—per-note actions: pin, move to folder, delete, restore.

---

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
git clone https://github.com/EpicenterHQ/epicenter.git
cd epicenter
bun install
cd apps/honeycrisp
bun dev
```

By default this runs against a local dev server on port 5175. To run against the production sync server:

```bash
bun run dev:remote
```

---

## Tech stack

- [SvelteKit](https://kit.svelte.dev)—UI framework (static adapter, SSR disabled)
- [ProseMirror](https://prosemirror.net) + [y-prosemirror](https://github.com/yjs/y-prosemirror)—collaborative rich-text editing
- [Yjs](https://yjs.dev)—CRDT engine (Y.Doc, Y.XmlFragment)
- [Tailwind CSS](https://tailwindcss.com)—styling
- [Better Auth](https://better-auth.com)—authentication
- `@epicenter/workspace`—CRDT-backed tables, versioning, E2E encryption
- `@epicenter/svelte`—auth, workspace gate, reactive table/KV bindings
- `@epicenter/ui`—shadcn-svelte component library

---

## License

MIT
