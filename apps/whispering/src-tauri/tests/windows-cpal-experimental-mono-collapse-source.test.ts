import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL mono collapse', () => {
	test('collapses buffered in-memory capture to mono when the device exposes multiple channels', () => {
		const source = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(source).toContain('EXPERIMENTAL_CAPTURE_OUTPUT_CHANNELS');
		expect(source).toContain(
			'let output_channels = if write_mode == RecorderWriteMode::BufferedMemory',
		);
		expect(source).toContain('append_f32_interleaved_mono');
		expect(source).toContain('append_i16_interleaved_mono');
		expect(source).toContain('append_u16_interleaved_mono');
	});
});
