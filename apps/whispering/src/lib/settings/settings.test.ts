import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('settings schema', () => {
	test('includes a cpu default for Parakeet acceleration', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'transcription.parakeet.acceleration'");
		expect(settingsSource).toContain(".default('cpu')");
	});
});
