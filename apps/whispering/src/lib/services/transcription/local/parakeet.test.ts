import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Parakeet acceleration plumbing', () => {
	test('passes the configured acceleration mode into the Parakeet Tauri command', () => {
		const serviceSource = readFileSync(new URL('./parakeet.ts', import.meta.url), 'utf8');

		expect(serviceSource).toContain('accelerationMode');
		expect(serviceSource).toContain('deviceId');
		expect(serviceSource).toContain("invoke<string>('transcribe_audio_parakeet'");
		expect(serviceSource).toContain('accelerationMode: options.accelerationMode');
		expect(serviceSource).toContain('deviceId: options.deviceId ?? null');
	});

	test('threads the Parakeet acceleration setting from the transcription query', () => {
		const querySource = readFileSync(
			new URL('../../../query/transcription.ts', import.meta.url),
			'utf8',
		);

		expect(querySource).toContain("'transcription.parakeet.acceleration'");
		expect(querySource).toContain("'transcription.parakeet.directmlAdapter'");
		expect(querySource).toContain('accelerationMode');
		expect(querySource).toContain('deviceId');
		expect(querySource).toContain("services.os.type() === 'windows'");
		expect(querySource).toContain(": 'cpu';");
		expect(querySource).toContain('accelerationMode: parakeetAccelerationMode');
	});
});
