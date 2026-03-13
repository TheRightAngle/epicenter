import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Parakeet DirectML Rust wiring', () => {
	test('threads an acceleration mode through the Parakeet Tauri command', () => {
		const transcriptionSource = readFileSync(
			new URL('../src/transcription/mod.rs', import.meta.url),
			'utf8',
		);

		expect(transcriptionSource).toContain('transcribe_audio_parakeet');
		expect(transcriptionSource).toContain('acceleration_mode: String');
		expect(transcriptionSource).toContain('device_id: Option<i32>');
		expect(transcriptionSource).toContain('get_or_load_parakeet(');
		expect(transcriptionSource).toContain('acceleration_mode');
	});

	test('includes acceleration mode in the model manager cache identity', () => {
		const managerSource = readFileSync(
			new URL('../src/transcription/model_manager.rs', import.meta.url),
			'utf8',
		);

		expect(managerSource).toContain('ParakeetAccelerationMode');
		expect(managerSource).toContain('current_parakeet_mode');
		expect(managerSource).toContain('DirectML { device_id: Option<i32> }');
	});

	test('uses the vendored transcribe-rs crate with DirectML enabled on Windows', () => {
		const cargoSource = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');

		expect(cargoSource).toContain('path = "vendor/transcribe-rs"');
		expect(cargoSource).toContain('features = ["onnx", "directml"]');
	});

	test('registers a Windows DirectML adapter enumeration command', () => {
		const libSource = readFileSync(new URL('../src/lib.rs', import.meta.url), 'utf8');
		const transcriptionSource = readFileSync(
			new URL('../src/transcription/mod.rs', import.meta.url),
			'utf8',
		);

		expect(transcriptionSource).toContain('list_directml_adapters');
		expect(libSource).toContain('list_directml_adapters');
	});
});
