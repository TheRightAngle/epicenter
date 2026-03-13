import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const tauriConfig = JSON.parse(
  readFileSync(new URL('../tauri.conf.json', import.meta.url), 'utf8'),
) as {
  bundle?: {
    resources?: string[] | string;
  };
};

describe('windows tray resource bundling', () => {
	test('bundles recorder state icons for the tray', () => {
		const resources = tauriConfig.bundle?.resources;
		const values = Array.isArray(resources)
			? resources
			: resources
				? [resources]
				: [];

		expect(values).toEqual(
			expect.arrayContaining([
				'recorder-state-icons/studio_microphone.png',
				'recorder-state-icons/red_large_square.png',
			]),
		);
	});
});
