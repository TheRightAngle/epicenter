import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const SOURCE_PATH = new URL('./check-for-updates.ts', import.meta.url);

describe('check-for-updates source wiring', () => {
	test('gates production update checks behind an explicit build flag', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');

		expect(source).toContain('if (!shouldCheckForUpdates())');
		expect(source).toContain(
			"return import.meta.env.VITE_WHISPERING_ENABLE_UPDATES === 'true';",
		);
	});
});
