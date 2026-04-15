# @epicenter/filesystem

`@epicenter/filesystem` gives Epicenter a POSIX-style filesystem backed by Yjs data. File metadata lives in a workspace table, each file's content lives in its own Y.Doc-backed document, and the package turns that split into familiar operations like `mkdir`, `writeFile`, `mv`, `rm`, and `stat`. Apps use it when they want collaborative data to look and behave like files and folders instead of raw CRDT structures.

## Installation

Inside this monorepo:

```json
{
	"dependencies": {
		"@epicenter/filesystem": "workspace:*"
	}
}
```

This package has a peer dependency on `yjs`.

## Quick usage

The basic setup from the tests is short: define the `files` table in a workspace, then hand the table helper and document collection to `createYjsFileSystem`.

```typescript
import { createWorkspace } from '@epicenter/workspace';
import { createYjsFileSystem, filesTable } from '@epicenter/filesystem';

const ws = createWorkspace({ id: 'test', tables: { files: filesTable } });
const fs = createYjsFileSystem(ws.tables.files, ws.documents.files.content);

await fs.mkdir('/docs');
await fs.writeFile('/docs/hello.txt', 'Hello World');
await fs.appendFile('/docs/hello.txt', ' again');
await fs.mv('/docs/hello.txt', '/docs/greeting.txt');

const content = await fs.readFile('/docs/greeting.txt');
const stats = await fs.stat('/docs/greeting.txt');
```

That is the actual shape used in `src/file-system.test.ts`. The object returned by `createYjsFileSystem` matches the `just-bash` filesystem interface, with a few extra helpers layered on top.

## How the model works

The package splits filesystem state into two parts.

- The `filesTable` row tracks metadata: `id`, `name`, `parentId`, `type`, `size`, timestamps, and soft-delete state.
- The content for each file lives in a document keyed by that row ID.

That gives you a useful mix of properties:

- directory listings and path lookups stay cheap because they only touch table metadata
- file content remains collaborative because each file is still a Yjs document
- soft deletes are easy because `rm` marks rows as trashed instead of immediately destroying history

It feels like a filesystem because the package keeps resolving paths, parents, and names for you. Underneath, it is still workspace data all the way down.

## API overview

Main exports from `src/index.ts`:

- `createYjsFileSystem()` and `YjsFileSystem` — the POSIX-like filesystem orchestrator
- `filesTable`, `FileRow`, and `ColumnDefinition` — the shared metadata table and related types
- `createFileTree()` and `createFileSystemIndex()` — path/index helpers for the metadata layer
- `FS_ERRORS` and `FsErrorCode` — filesystem-style error helpers
- `posixResolve()` — path normalization for slash-separated paths
- Markdown helpers like `parseFrontmatter()`, `serializeMarkdownWithFrontmatter()`, and `serializeXmlFragmentToMarkdown()`
- Link helpers like `convertWikilinksToInternalLinks()` and `makeInternalHref()`
- `createSqliteIndex()` — optional SQLite-backed indexing for search results

If you only need the filesystem abstraction, start with `createYjsFileSystem()` and `filesTable`. The rest supports indexing, markdown, and tree-level operations.

## POSIX-style behavior

The surface area is intentionally familiar.

- `mkdir`, `readdir`, and `readdirWithFileTypes` cover directory work
- `writeFile`, `appendFile`, `readFile`, and `readFileBuffer` cover content I/O
- `mv` and `cp` handle renames and copies
- `rm` performs soft deletes, with recursive behavior for folders
- `stat`, `lstat`, `exists`, `realpath`, and `resolvePath` cover inspection and path resolution

There are a few deliberate limits. Symlinks and hard links always throw `ENOSYS`. Permissions are mostly a validated no-op. That is not an accident—it keeps the model aligned with a collaborative CRDT-backed store instead of pretending to be a full kernel filesystem.

## Relationship to other packages

`@epicenter/filesystem` sits on top of `@epicenter/workspace` and turns workspace tables plus document collections into file semantics.

```text
@epicenter/workspace   typed tables + documents
        │
@epicenter/filesystem  tree index + file content orchestration
        │
apps like Opensidian   markdown notes, paths, links, indexing
```

In the monorepo, apps can treat shared workspace content as files without giving up Yjs collaboration. That is the point of this package.

Most Epicenter apps use [`@epicenter/workspace`](../workspace) directly and don't need this package. Workspace tables are the right default when the app knows the shape of every record upfront—notes with titles, bookmarks with URLs, chat messages with timestamps. Reach for `@epicenter/filesystem` when the data model is inherently hierarchical files: a code editor, a note vault with nested folders, anything where users expect a file tree and path-based operations.

Honeycrisp (Apple Notes clone) uses only workspace tables. Opensidian (file-based editor with a bash terminal) uses both—`filesTable` from this package alongside plain workspace tables for chat and settings. See [Your Data Is Probably a Table, Not a File](../../docs/articles/your-data-is-probably-a-table-not-a-file.md) for the full comparison.

## License

MIT.
