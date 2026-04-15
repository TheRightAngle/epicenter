# Fuji

Fuji is a local-first CMS where every entry's body is its own CRDT. Write offline, sync later, and collaborate on a single entry without touching the rest of your content. Think of it as a structured journal, knowledge base, or portfolio—whatever you tag and type your entries as.

Part of the [Epicenter](https://github.com/EpicenterHQ/epicenter) monorepo. MIT licensed.

---

## How it works

### Layout

SvelteKit app (static adapter, SSR disabled) with three panels: a sidebar for filtering by type, tags, and search; a main area that toggles between table and timeline views; and an editor panel for rich-text content.

### Data model

Workspace ID: `epicenter.fuji`. Rich-text content and entry metadata are separate CRDTs. The entries table stays lean—just IDs, titles, tags, timestamps—while each entry's body lives in its own `Y.Text` document via `withDocument`. Loading a list of 500 entries doesn't mean loading 500 rich-text trees; the editor and the list never contend for the same document.

- `entries` table—`id` (EntryId), `title`, `subtitle`, `type` (string[]), `tags` (string[]), `createdAt`, `updatedAt`, `_v`. Each entry carries an attached content document bound to ProseMirror via `y-prosemirror`.
- KV keys—`selectedEntryId`, `viewMode` (`'table' | 'timeline'`), `sidebarCollapsed`.

### Client wiring

```ts
createWorkspace(fujiWorkspace)
  .withExtension('persistence', indexeddbPersistence)
  .withExtension('sync', createSyncExtension({ url, getToken }))
```

Encryption keys are applied on login. Local data is cleared on logout.

### Editor

ProseMirror with `y-prosemirror` binds directly to the entry's `Y.Text`. Edits are conflict-free by default; two sessions editing the same entry merge automatically.

### Keyboard shortcuts

- `Cmd+N`—new entry
- `Escape`—deselect current entry

---

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
git clone https://github.com/EpicenterHQ/epicenter.git
cd epicenter
bun install
cd apps/fuji
bun dev
```

By default this runs against a local dev server on port 5174. To run against the production sync server:

```bash
bun run dev:remote
```

---

## Tech stack

- [SvelteKit](https://kit.svelte.dev)—UI framework (static adapter, SSR disabled)
- [ProseMirror](https://prosemirror.net) + [y-prosemirror](https://github.com/yjs/y-prosemirror)—collaborative rich-text editing
- [TanStack Svelte Table](https://tanstack.com/table)—entry list table view
- [Yjs](https://yjs.dev)—CRDT engine
- [Tailwind CSS](https://tailwindcss.com)—styling
- `@epicenter/workspace`—CRDT-backed tables, versioning, documents
- `@epicenter/svelte`—auth, workspace gate, reactive table/KV bindings
- `@epicenter/ui`—shadcn-svelte component library

---

## License

MIT
