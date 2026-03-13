import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Parakeet DirectML adapter settings UI', () => {
	test('shows an adapter selector for Windows DirectML acceleration', () => {
		const pageSource = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

		expect(pageSource).toContain("'transcription.parakeet.directmlAdapter'");
		expect(pageSource).toContain('GPU Adapter');
		expect(pageSource).toContain('Auto (default adapter)');
	});
});
