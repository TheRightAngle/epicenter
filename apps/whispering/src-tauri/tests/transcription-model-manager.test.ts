import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const SOURCE_PATH = new URL('../src/transcription/model_manager.rs', import.meta.url);

describe('ModelManager source wiring', () => {
	test('recovers poisoned model-manager locks instead of treating them as terminal', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');

		expect(source).toContain("fn recover_lock<'a, T, F>");
		expect(source).toContain('recover_lock(&self.engine, "Engine"');
		expect(source).toContain('recover_lock(&self.current_model_path, "Model path"');
		expect(source).toContain('recover_lock(&self.last_activity, "Last activity"');
		expect(source).not.toContain(
			'Engine mutex poisoned (likely due to previous panic)',
		);
	});
});
