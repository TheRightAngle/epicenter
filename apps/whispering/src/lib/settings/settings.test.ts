import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('settings schema', () => {
	test('defaults analytics to disabled', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'analytics.enabled': 'boolean = false'");
	});

	test('defaults recording retention to never save new recordings', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain(".default('limit-count')");
		expect(settingsSource).toContain("'database.maxRecordingCount': type('string.digits').default('0')");
	});
});
