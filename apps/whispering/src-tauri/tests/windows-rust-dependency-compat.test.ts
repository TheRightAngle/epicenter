import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Rust dependency compatibility guards', () => {
	test('uses the rubato 1.x async resampler API', () => {
		const transcriptionSource = readFileSync(
			new URL('../src/transcription/mod.rs', import.meta.url),
			'utf8',
		);
		const cargoSource = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');

		expect(cargoSource).toContain('audioadapter-buffers = "2.0.0"');
		expect(transcriptionSource).toContain('Async::<f32>::new_sinc(');
		expect(transcriptionSource).toContain('SequentialSliceOfVecs::new(');
		expect(transcriptionSource).toContain('process_all_into_buffer');
		expect(transcriptionSource).not.toContain('SincFixedIn');
	});

	test('uses the cpal 0.17 sample-rate API', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(recorderSource).toContain('let sample_rate = config.sample_rate();');
		expect(recorderSource).toContain('sample_rate,');
		expect(recorderSource).toContain('config.min_sample_rate()');
		expect(recorderSource).toContain('config.max_sample_rate()');
		expect(recorderSource).not.toContain('cpal::SampleRate(');
		expect(recorderSource).not.toContain('.sample_rate().0');
		expect(recorderSource).not.toContain('.min_sample_rate().0');
		expect(recorderSource).not.toContain('.max_sample_rate().0');
	});
});
