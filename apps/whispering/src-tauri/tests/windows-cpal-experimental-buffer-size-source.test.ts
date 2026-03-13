import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL buffer sizing', () => {
	test('uses an explicit larger buffer size only for experimental capture', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(recorderSource).toContain('SupportedBufferSize');
		expect(recorderSource).toContain('BufferSize::Fixed');
		expect(recorderSource).toContain('resolve_stream_buffer_size(');
		expect(recorderSource).toContain('RecorderWriteMode::BufferedMemory');
	});
});
