import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(
	new URL('./settings.ts', import.meta.url),
	'utf8',
);

const generalSettingsSource = readFileSync(
	new URL('../../routes/(app)/(config)/settings/+page.svelte', import.meta.url),
	'utf8',
);

const desktopTextSource = readFileSync(
	new URL('../services/text/desktop.ts', import.meta.url),
	'utf8',
);

describe('fast output mode', () => {
	test('adds a disabled-by-default setting', () => {
		expect(settingsSource).toContain("'output.fastMode': 'boolean = false'");
	});

	test('exposes a general settings toggle', () => {
		expect(generalSettingsSource).toContain('Fast output mode');
		expect(generalSettingsSource).toContain("settings.value['output.fastMode']");
	});

	test('wires a dedicated fast native write path', () => {
		expect(desktopTextSource).toContain("'write_text_fast'");
	});
});
