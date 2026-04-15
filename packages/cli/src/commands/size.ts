/**
 * `epicenter size` — report encoded byte size and per-table row counts.
 *
 * Unlike most commands, `size` uses `loadConfig()` directly instead of
 * `runCommand` because it needs to iterate ALL workspace clients, not just one.
 */

import type { AnyWorkspaceClient } from '@epicenter/workspace';
import type { Argv } from 'yargs';
import { loadConfig } from '../load-config';
import { defineCommand, withWorkspaceOptions } from '../util/command';
import { output, outputError } from '../util/format-output';

/** Format a byte count as a human-readable string with 1 decimal place. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type WorkspaceSizeResult = {
	id: string;
	encodedSize: number;
	tables: Record<string, { rows: number }>;
};

/**
 * `epicenter size` — report encoded byte size and per-table row counts
 * for every workspace in the config.
 *
 * Outputs a human-readable summary by default, or machine-readable JSON
 * with `--format json`.
 *
 * @example
 * ```bash
 * epicenter size                       # all workspaces, human-readable
 * epicenter size -w blog               # single workspace
 * epicenter size --format json         # machine-readable JSON
 * epicenter size -C apps/my-project    # different directory
 * ```
 */
export const sizeCommand = defineCommand({
	command: 'size',
	describe: 'Report encoded size and row counts for all workspaces',
	builder: (y: Argv) => withWorkspaceOptions(y),
	handler: async (argv: any) => {
		try {
			const { clients } = await loadConfig(argv.dir);

			try {
				let targets: AnyWorkspaceClient[] = clients;
				if (argv.workspace) {
					const found = clients.find((c) => c.id === argv.workspace);
					if (!found) {
						const ids = clients.map((c) => c.id).join(', ');
						throw new Error(
							`Workspace "${argv.workspace}" not found. Available: ${ids}`,
						);
					}
					targets = [found];
				}

				const results: WorkspaceSizeResult[] = [];
				for (const client of targets) {
					await client.whenReady;
					const tableNames = Object.keys(client.definitions.tables);
					const tables: Record<string, { rows: number }> = {};
					for (const name of tableNames) {
						const table = client.tables[name];
						if (table) tables[name] = { rows: table.count() };
					}
					results.push({
						id: client.id,
						encodedSize: client.encodedSize(),
						tables,
					});
				}

				if (argv.format) {
					output(results, { format: argv.format });
				} else {
					for (const [i, result] of results.entries()) {
						if (i > 0) console.log('');
						console.log(`${result.id} (${formatBytes(result.encodedSize)})`);

						const entries = Object.entries(result.tables);
						if (entries.length > 0) {
							const maxNameLen = Math.max(
								...entries.map(([name]) => name.length),
							);
							const maxCountLen = Math.max(
								...entries.map(([, t]) => String(t.rows).length),
							);
							for (const [name, t] of entries) {
								const paddedName = name.padEnd(maxNameLen);
								const paddedCount = String(t.rows).padStart(maxCountLen);
								console.log(`  ${paddedName}  ${paddedCount} rows`);
							}
						}
					}
				}
			} finally {
				await Promise.all(clients.map((c) => c.dispose()));
			}
		} catch (err) {
			outputError(err instanceof Error ? err.message : String(err));
			process.exitCode = 1;
		}
	},
});
