/**
 * Tab Manager workspace factory — creates a workspace client with portable actions.
 *
 * Includes data-only actions that work in any JS runtime (e.g. `devices.list`).
 * Chrome-specific actions (tabs.close, tabs.open, etc.) are chained at the
 * call site in `client.ts`.
 *
 * @example
 * ```typescript
 * import { createTabManagerWorkspace } from '@epicenter/tab-manager/workspace'
 *
 * const ws = createTabManagerWorkspace()
 *   .withExtension('persistence', indexeddbPersistence)
 * ```
 */

import { createWorkspace, defineQuery } from '@epicenter/workspace';
import { definition } from './definition';

export function createTabManagerWorkspace() {
	return createWorkspace(definition).withActions(({ tables }) => ({
		devices: {
			/**
			 * List all synced devices with their names, browsers, and online status.
			 *
			 * Portable — reads from the devices table only, no browser APIs needed.
			 */
			list: defineQuery({
				title: 'List Devices',
				description:
					'List all synced devices with their names, browsers, and online status.',

				handler: () => {
					const devices = tables.devices.getAllValid();
					return {
						devices: devices.map((d) => ({
							id: d.id,
							name: d.name,
							browser: d.browser,
							lastSeen: d.lastSeen,
						})),
					};
				},
			}),
		},
	}));
}
