import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL buffered capture wiring', () => {
	test('threads the experimental buffered capture flag into the recorder session', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);
		const commandSource = readFileSync(
			new URL('../src/recorder/commands.rs', import.meta.url),
			'utf8',
		);

		expect(commandSource).toContain('experimental_buffered_capture: Option<bool>');
		expect(commandSource).toContain('experimental_buffered_capture,');
		expect(recorderSource).toContain('experimental_buffered_capture: bool');
		expect(recorderSource).toContain('RecorderWriteMode::Buffered');
		expect(recorderSource).toContain('RecorderWriteMode::Inline');
		expect(recorderSource).toContain('spawn_buffered_writer_thread');
		expect(recorderSource).toContain('mpsc::sync_channel');
	});
});
