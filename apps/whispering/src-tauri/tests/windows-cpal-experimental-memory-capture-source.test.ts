import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL in-memory capture wiring', () => {
	test('keeps experimental capture in memory and returns audio data without a file path', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(recorderSource).toContain('RecorderWriteMode::BufferedMemory');
		expect(recorderSource).toContain('in_memory_audio');
		expect(recorderSource).toContain('AudioRecording {');
		expect(recorderSource).toContain('file_path: None');
		expect(recorderSource).toContain('audio_data,');
		expect(recorderSource).toContain('fn finalize_in_memory_audio(');
	});
});
