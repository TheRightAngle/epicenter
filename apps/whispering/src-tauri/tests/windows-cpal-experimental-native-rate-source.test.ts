import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Experimental CPAL native-rate preference', () => {
	test('lets experimental capture prefer the device default input config instead of forcing 16 kHz', () => {
		const source = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(source).toContain('prefer_native_rate: bool');
		expect(source).toContain('default_input_config()');
		expect(source).toContain('write_mode == RecorderWriteMode::BufferedMemory');
	});
});
