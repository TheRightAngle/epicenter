import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const SOURCE_PATH =
	'/home/dev/projects/whispering/.worktrees/windows-function-first-fixes/apps/whispering/src/lib/components/settings/LocalModelDownloadCard.svelte';

describe('LocalModelDownloadCard source wiring', () => {
	test('uses runtime local-model validation for refresh and post-download activation', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');

		expect(source).toContain('validateConfiguredLocalModelPath');
		expect(source).not.toContain('validateLocalModelInstall');
		expect(source).toContain(
			"throw new Error('Downloaded model did not pass runtime validation.')",
		);
	});
});
