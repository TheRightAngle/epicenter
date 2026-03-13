import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL in-memory audio handoff', () => {
	test('reserves the in-memory audio path for recordings returned without a file path', async () => {
		const source = await Bun.file(
			new URL('./cpal.ts', import.meta.url),
		).text();

		expect(source).toContain('audioRecording.audioData?.length');
		expect(source).toContain('audioDataToBlob(');
		expect(source).toContain('audioRecording.filePath');
	});
});
