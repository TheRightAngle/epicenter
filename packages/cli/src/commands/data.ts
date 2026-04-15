/**
 * Table CRUD, table listing, and data export commands.
 *
 * All table operations share the same shape: load workspace → resolve table →
 * run operation → output. They're co-located here to avoid 6 nearly-identical files.
 */

import type { Argv } from 'yargs';
import {
	defineCommand,
	resolveTable,
	runCommand,
	withWorkspaceOptions,
} from '../util/command';

// ─── Table CRUD ──────────────────────────────────────────────────────────────

/**
 * `epicenter get <table> <id>` — get a single row by ID.
 *
 * @example
 * ```bash
 * epicenter get posts abc123
 * epicenter get posts abc123 -w my-workspace --format json
 * ```
 */
export const getCommand = defineCommand({
	command: 'get <table> <id>',
	describe: 'Get a row by ID from a table',
	builder: (y: Argv) =>
		withWorkspaceOptions(y)
			.positional('table', { type: 'string', demandOption: true })
			.positional('id', { type: 'string', demandOption: true }),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => {
				const result = resolveTable(client, argv.table).get(argv.id);
				if (result.status !== 'valid')
					throw new Error(`Row not found: ${argv.id}`);
				return result.row;
			},
			argv.format,
		);
	},
});

/**
 * `epicenter list <table>` — list all valid rows.
 *
 * @example
 * ```bash
 * epicenter list posts
 * epicenter list posts --format jsonl
 * ```
 */
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

/**
 * `epicenter count <table>` — count valid rows.
 *
 * @example
 * ```bash
 * epicenter count posts
 * ```
 */
export const countCommand = defineCommand({
	command: 'count <table>',
	describe: 'Count valid rows in a table',
	builder: (y: Argv) =>
		withWorkspaceOptions(y).positional('table', {
			type: 'string',
			demandOption: true,
		}),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => ({
				count: resolveTable(client, argv.table).getAllValid().length,
			}),
			argv.format,
		);
	},
});

/**
 * `epicenter delete <table> <id>` — delete a row by ID.
 *
 * @example
 * ```bash
 * epicenter delete posts abc123
 * ```
 */
export const deleteCommand = defineCommand({
	command: 'delete <table> <id>',
	describe: 'Delete a row by ID from a table',
	builder: (y: Argv) =>
		withWorkspaceOptions(y)
			.positional('table', { type: 'string', demandOption: true })
			.positional('id', { type: 'string', demandOption: true }),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => {
				resolveTable(client, argv.table).delete(argv.id);
				return { status: 'deleted', id: argv.id };
			},
			argv.format,
		);
	},
});

// ─── Introspection ───────────────────────────────────────────────────────────

/**
 * `epicenter tables` — list all table names.
 *
 * @example
 * ```bash
 * epicenter tables
 * epicenter tables -w my-workspace
 * ```
 */
export const tablesCommand = defineCommand({
	command: 'tables',
	describe: 'List all table names in the workspace',
	builder: (y: Argv) => withWorkspaceOptions(y),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => Object.keys(client.definitions.tables),
			argv.format,
		);
	},
});

/**
 * `epicenter export` — export all workspace data as JSON.
 *
 * Outputs a JSON object where each key is a table name and the value
 * is an array of valid rows.
 *
 * @example
 * ```bash
 * epicenter export
 * epicenter export --table posts
 * epicenter export --format json > backup.json
 * ```
 */
export const exportCommand = defineCommand({
	command: 'export',
	describe: 'Export workspace data as JSON',
	builder: (y: Argv) =>
		withWorkspaceOptions(y).option('table', {
			type: 'string',
			describe: 'Export only a specific table',
		}),
	handler: async (argv: any) => {
		await runCommand(
			{ dir: argv.dir, workspaceId: argv.workspace },
			(client) => {
				const data: Record<string, unknown[]> = {};
				const tableNames = argv.table
					? [argv.table as string]
					: Object.keys(client.definitions.tables);

				for (const tableName of tableNames) {
					const table = client.tables[tableName];
					if (!table) {
						throw new Error(
							`Table "${tableName}" not found in workspace "${client.id}"`,
						);
					}
					data[tableName] = table.getAllValid();
				}

				return data;
			},
			argv.format,
		);
	},
});
