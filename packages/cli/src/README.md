# Epicenter CLI

Manage workspace data from the command line.

## Command Structure

```bash
epicenter get <table> <id>           # get a row by ID
epicenter list <table>               # list all valid rows
epicenter count <table>              # count valid rows
epicenter delete <table> <id>        # delete a row
epicenter tables                     # list table names

epicenter kv get <key>               # read a KV value
epicenter kv set <key> [value]       # write a KV value
epicenter kv delete <key>            # delete a KV entry

epicenter run <action.path> [--args] # invoke a workspace action
epicenter describe                   # dump workspace schema as JSON
epicenter export                     # export all data as JSON
epicenter size                       # report workspace sizes and row counts

epicenter init                       # scaffold a new project

epicenter start [dir]                # start the workspace daemon
epicenter auth login --server <url>  # device-code login
epicenter auth logout                # clear session
epicenter auth status                # check auth state
```

## Table Commands

```bash
epicenter list posts                 # list all valid rows
epicenter get posts abc123           # get row by ID
epicenter count posts                # count valid rows
epicenter delete posts abc123        # delete row
epicenter tables                     # list table names
```

## KV Commands

```bash
epicenter kv get <key>               # get value
epicenter kv set <key> <value>       # set value
epicenter kv delete <key>            # delete key
```

## Action Commands

```bash
epicenter run posts.getAll           # invoke a query action
epicenter run posts.create --title "Hello"  # invoke with input flags
epicenter describe                   # show all schemas and actions
```

## Output Formats

```bash
epicenter list posts                 # pretty JSON (TTY)
epicenter list posts | jq            # compact JSON (pipe)
epicenter list posts --format json   # force JSON
epicenter list posts --format jsonl  # JSON lines
```

## Working Directory

By default, Epicenter looks for `epicenter.config.ts` in the current directory.

Use `-C` or `--dir` to run from a different directory:

```bash
epicenter -C apps/blog list posts
epicenter --dir apps/shop get products abc123
```

## Multiple Workspaces

If your config exports multiple workspaces, use `-w` to select one:

```bash
epicenter list posts -w my-blog
epicenter get posts abc123 -w my-blog
```

## Size Commands

```bash
epicenter size                       # all workspaces, human-readable
epicenter size -w blog               # single workspace
epicenter size --format json         # machine-readable JSON
epicenter size -C apps/my-project    # different directory
```

## Playground Configs

The `playground/` directory contains standalone `epicenter.config.ts` files that sync workspace data from the Epicenter API down to local persistence and markdown files. Each playground is a self-contained project that consumes a workspace package.

```bash
# Tab Manager — syncs saved tabs, bookmarks, and devices
epicenter start playground/tab-manager-e2e --verbose

# Opensidian — syncs notes with document content as markdown body
epicenter start playground/opensidian-e2e --verbose
```

Run `epicenter auth login --server https://api.epicenter.so` first to store your session credentials.

See each playground's `README.md` for details on what it produces and how to query the data.
