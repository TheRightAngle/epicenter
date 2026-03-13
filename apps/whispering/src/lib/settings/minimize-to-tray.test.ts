import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('minimize to tray setting', () => {
	test('adds a disabled-by-default setting', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'system.minimizeToTray': 'boolean = false'");
	});

	test('exposes a general settings toggle', () => {
		const settingsPageSource = readFileSync(
			new URL('../../routes/(app)/(config)/settings/+page.svelte', import.meta.url),
			'utf8',
		);

		expect(settingsPageSource).toContain('Minimize to tray');
		expect(settingsPageSource).toContain("settings.value['system.minimizeToTray']");
	});
});
