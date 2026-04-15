# Opensidian E2E

Syncs the Opensidian workspace from the Epicenter API down to local files. The daemon persists file metadata to SQLite and materializes each note as a `.md` file with YAML frontmatter (metadata) and markdown body (document content).

## Prerequisites

Log in to the Epicenter API first:

```bash
# Production
epicenter auth login --server https://api.epicenter.so

# Local dev (requires apps/api running)
bun epicenter auth login --server http://localhost:8787
```

This stores your session (access token + encryption keys) at `~/.epicenter/auth/sessions.json`.

## Usage

Start the daemon:

```bash
# Production (syncs from api.epicenter.so)
epicenter start playground/opensidian-e2e --verbose

# Local dev (syncs from localhost:8787)
bun epicenter start playground/opensidian-e2e --verbose
```

The daemon syncs workspace data and writes markdown files to `data/files/`. It keeps running until you hit Ctrl+C. Leave it running alongside the Opensidian app if you want real-time materialization.

Query the workspace via CLI:

```bash
# These read local SQLite — same command either way
epicenter list files -C playground/opensidian-e2e
epicenter get files <id> -C playground/opensidian-e2e
epicenter count files -C playground/opensidian-e2e
epicenter describe -C playground/opensidian-e2e
```

## What it produces

```
playground/opensidian-e2e/
├── epicenter.config.ts              # Workspace config
├── .epicenter/
│   └── persistence/
│       └── opensidian.db            # SQLite persistence (files table)
└── data/
    └── files/
        ├── my-first-note-abc123.md  # Materialized file
        └── meeting-notes-def456.md  # Materialized file
```

Each `.md` file looks like:

```markdown
---
id: abc123
name: my-first-note.md
parentId: folder-id-xyz
size: 0
createdAt: 1712300000000
updatedAt: 1712300000000
trashedAt: null
---

# My First Note

The actual document content from the editor.
```

## How it works

The config chains four extensions onto the Opensidian workspace:

1. **Persistence** — workspace-only SQLite. Persists the files table so it survives daemon restarts without re-downloading everything from the server.

2. **Markdown materializer** — custom one-way projection (Y.Doc → files). Observes the files table; for each file, reads document content via `documents.files.content.open(id)` and writes a `.md` file with frontmatter + body. Document content changes trigger `updatedAt` on the row, which fires the observer and re-materializes.

3. **Encryption unlock** — reads encryption keys from the CLI session store so encrypted fields can be decrypted locally.

4. **Sync** — WebSocket connection to the Epicenter API for real-time data sync.

## Running alongside Opensidian

You can run the daemon while Opensidian is open in your browser. Both connect to the same Epicenter API via WebSocket sync, so changes in the app appear as materialized `.md` files within seconds. The daemon is read-only—it doesn't write back to the workspace from disk changes.
