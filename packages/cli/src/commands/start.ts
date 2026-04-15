/**
 * `epicenter start [dir]` — long-lived workspace daemon.
 *
 * Loads workspace config, waits for all clients to be ready, logs status
 * (including active extensions per workspace), and stays alive until
 * SIGINT/SIGTERM.
 */

import type { Argv } from 'yargs';
import { loadConfig } from '../load-config';
import { defineCommand } from '../util/command';

// ─── Daemon runtime ──────────────────────────────────────────────────────────

type StartDaemonOptions = {
	/** Directory containing epicenter.config.ts. Defaults to cwd. */
	dir?: string;
	/** Enable periodic heartbeat logging. */
	verbose?: boolean;
};

/**
 * Start the sync daemon.
 *
 * Returns a cleanup function and the list of active clients.
 * The daemon stays alive until the returned `shutdown()` is called
 * or the process receives SIGINT/SIGTERM.
 */
async function startDaemon(options: StartDaemonOptions = {}) {
	const targetDir = options.dir ?? process.cwd();
	const { configDir, clients } = await loadConfig(targetDir);

	await Promise.all(clients.map((c) => c.whenReady));

	// ─── Log status ──────────────────────────────────────────────────────

	console.log(`✓ Started — ${clients.length} workspace(s)`);
	console.log(`  Config: ${configDir}`);

	for (const client of clients) {
		const extensionNames = Object.keys(client.extensions ?? {});
		const extLabel =
			extensionNames.length > 0 ? extensionNames.join(', ') : '(none)';
		console.log(`  ${client.id}: extensions=[${extLabel}]`);
	}

	console.log('');
	console.log('Press Ctrl+C to stop');

	// ─── Verbose heartbeat ───────────────────────────────────────────────

	let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
	if (options.verbose) {
		heartbeatInterval = setInterval(() => {
			const uptime = process.uptime();
			const hours = Math.floor(uptime / 3600);
			const minutes = Math.floor((uptime % 3600) / 60);
			const seconds = Math.floor(uptime % 60);
			console.log(
				`  ♥ alive — ${hours}h ${minutes}m ${seconds}s — ${clients.length} workspace(s)`,
			);
		}, 30_000);
	}

	// ─── Graceful shutdown ───────────────────────────────────────────────

	async function shutdown() {
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		console.log('\nShutting down...');
		await Promise.all(clients.map((c) => c.dispose()));
		console.log('✓ Graceful shutdown complete');
	}

	const sigintHandler = async () => {
		await shutdown();
		process.exit(0);
	};

	process.on('SIGINT', sigintHandler);
	process.on('SIGTERM', sigintHandler);

	return {
		/** All active workspace clients. */
		clients,
		/** Resolved config directory. */
		configDir,
		/** Gracefully destroy all clients and clean up signal handlers. */
		async shutdown() {
			process.off('SIGINT', sigintHandler);
			process.off('SIGTERM', sigintHandler);
			await shutdown();
		},
	};
}

// ─── Command ─────────────────────────────────────────────────────────────────

/**
 * @example
 * ```bash
 * epicenter start
 * epicenter start ./my-project
 * epicenter start --verbose
 * ```
 */
export const startCommand = defineCommand({
	command: 'start [dir]',
	describe: 'Start the workspace daemon for a directory',
	builder: (y: Argv) =>
		y
			.positional('dir', {
				type: 'string' as const,
				default: '.',
				describe:
					'Directory containing epicenter.config.ts (default: current directory)',
			})
			.option('verbose', {
				type: 'boolean',
				default: false,
				describe: 'Enable periodic heartbeat logging',
			}),
	handler: async (argv) => {
		try {
			await startDaemon({
				dir: argv.dir as string | undefined,
				verbose: argv.verbose as boolean | undefined,
			});
		} catch (err) {
			console.error(
				`Failed to start: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}
	},
});
