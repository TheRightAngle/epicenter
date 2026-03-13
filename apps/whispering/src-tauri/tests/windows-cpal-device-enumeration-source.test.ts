import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Windows CPAL device enumeration wiring', () => {
	test('uses stable CPAL device ids and structured descriptions', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(recorderSource).toContain('RecordingDeviceInfo');
		expect(recorderSource).toContain('.id()');
		expect(recorderSource).toContain('device.description()');
		expect(recorderSource).toContain('.extended()');
		expect(recorderSource).toContain('host.device_by_id(&device_id)');
		expect(recorderSource).toContain('.collect::<Result<Vec<_>>>()?;');
	});
});
