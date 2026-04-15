import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('settings schema', () => {
	test('includes a cpu default for Parakeet acceleration', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'transcription.parakeet.acceleration'");
		expect(settingsSource).toContain(".default('cpu')");
	});

	test('defaults the Parakeet DirectML adapter selection to auto', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'transcription.parakeet.directmlAdapter'");
		expect(settingsSource).toContain("'transcription.parakeet.directmlAdapter': \"string = 'auto'\"");
	});

	test('includes an all-toasts default for toast visibility', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'notifications.toastVisibility'");
		expect(settingsSource).toContain(".default('all')");
	});

	test('defaults analytics to disabled', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'analytics.enabled': 'boolean = false'");
	});

	test('defaults recording retention to never save new recordings', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain(".default('limit-count')");
		expect(settingsSource).toContain(
			"'database.maxRecordingCount': type('string.digits').default('0')",
		);
	});

	test('defaults CPAL in-memory buffering to disabled', () => {
		const settingsSource = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

		expect(settingsSource).toContain("'recording.cpal.bufferedCapture'");
		expect(settingsSource).toContain("'recording.cpal.bufferedCapture': 'boolean = false'");
	});
});
