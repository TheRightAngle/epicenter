# @epicenter/cli

`@epicenter/cli` is the package behind the `epicenter` command. It loads `epicenter.config.ts`, opens one or more workspace clients, runs a command, prints the result, and gets out of the way. Monorepo apps, playgrounds, and local debugging scripts use it when they need the same workspace data model outside the browser or desktop app.

## Installation

Inside this monorepo:

```json
{
	"dependencies": {
		"@epicenter/cli": "workspace:*"
	}
}
```

The package also exposes the `epicenter` binary through `src/bin.ts`.

## Quick usage

From the terminal, the normal entry points are the built-in commands:

```bash
bun epicenter start
bun epicenter start ./my-project --verbose

bun epicenter list posts
bun epicenter list posts --format jsonl
```

Inside the package, the binary is intentionally thin:

```typescript
import { hideBin } from 'yargs/helpers';
import { createCLI } from './cli';

await createCLI().run(hideBin(process.argv));
```

Command definitions follow the same pattern everywhere. `defineCommand` is just a typed identity helper, so each command stays close to plain yargs:

```typescript
export const listCommand = defineCommand({
	command: 'list <table>',
	describe: 'List all valid rows in a table',
	builder: (y: Argv) =>
		withWorkspaceOptions(y).positional('table', {
			type: 'string',
			demandOption: true,
		}),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => resolveTable(client, argv.table).getAllValid(),
			argv.format,
		);
	},
});
```

## API overview

Public exports from `src/index.ts`:

- `createCLI()` — build the yargs-based CLI runner
- `resolveEpicenterHome()` — resolve the session/config home directory
- `createAuthApi()` and `createSessionStore()` — auth helpers for CLI login state
- `createCliUnlock()` — workspace extension that loads encryption keys from the CLI session store
- `loadConfig()` — import `epicenter.config.ts` and collect named workspace exports

Those are the pieces meant for reuse. Most command wiring stays internal.

## How commands are defined

The package keeps command authoring boring on purpose.

- `createCLI()` registers top-level commands like `start`, `list`, `get`, `count`, `run`, `describe`, `size`, `rpc`, and `auth`.
- `defineCommand()` gives command modules type inference without adding runtime behavior.
- `runCommand()` handles the common lifecycle: load config, resolve the workspace, wait for readiness, print output, dispose clients.
- `withWorkspaceOptions()` adds the standard `--dir`, `--workspace`, and `--format` flags.

That split matters because it keeps each command file short. The command author writes the operation; the package handles the boilerplate once.

## TypeBox to yargs

Action input schemas already exist in the workspace layer, so the CLI reuses them. `src/util/typebox-to-yargs.ts` converts a TypeBox object schema into a yargs options record, carrying over things like descriptions, defaults, required fields, and simple enum-like choices.

The conversion is permissive by design. If a schema field does not map cleanly to a yargs primitive, the option still exists and the action can do stricter validation after parsing.

## Relationship to other packages

`@epicenter/cli` is a consumer-facing shell on top of the workspace package.

```text
epicenter command
        │
@epicenter/cli         yargs commands, config loading, auth/session helpers
        │
@epicenter/workspace   tables, actions, sync, persistence, documents
```

In the monorepo:

- playground projects use the binary to start workspace daemons and inspect data
- workspace packages reuse `createCliUnlock()` when they need CLI-stored auth and encryption keys
- the CLI does not reimplement sync or storage; it drives the APIs exposed by `@epicenter/workspace`

## License

MIT.
