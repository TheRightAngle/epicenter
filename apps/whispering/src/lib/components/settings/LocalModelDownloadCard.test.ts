import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const SOURCE_PATH = new URL('./LocalModelDownloadCard.svelte', import.meta.url);

describe('LocalModelDownloadCard source wiring', () => {
	test('uses runtime local-model validation for refresh and post-download activation', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');

		expect(source).toContain('validateConfiguredLocalModelPath');
		expect(source).not.toContain('validateLocalModelInstall');
		expect(source).toContain(
			"throw new Error('Downloaded model did not pass runtime validation.')",
		);
		expect(source).toContain("toast.error('Failed to activate model'");
		expect(source).toContain("let path = ''");
		expect(source).toContain('path = await ensureModelDestinationPath();');
	});
});
