import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('CPAL capture wiring', () => {
	test('threads the buffered-capture flag into the recorder session', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);
		const commandSource = readFileSync(
			new URL('../src/recorder/commands.rs', import.meta.url),
			'utf8',
		);

		// The Tauri command exposes the flag under its new name.
		expect(commandSource).toContain('buffered_capture: Option<bool>');
		expect(commandSource).toContain('buffered_capture,');

		// The recorder accepts the boolean and maps it to a write mode.
		expect(recorderSource).toContain('use_buffered_memory: bool');
		expect(recorderSource).toContain('RecorderWriteMode::BufferedMemory');
		expect(recorderSource).toContain('RecorderWriteMode::Inline');
		expect(recorderSource).toContain('InMemoryAudioBuffer::new(');
	});

	test('audio callback is channel-based and lock-free', () => {
		const recorderSource = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		// The callback must use a bounded SyncSender with try_send — not a
		// mutex around the WAV writer or in-memory buffer.
		expect(recorderSource).toContain('capture_tx: SyncSender<CaptureBatch>');
		expect(recorderSource).toContain('capture_tx.try_send(batch)');

		// No Arc<Mutex<WavWriter>> or Arc<Mutex<InMemoryAudioBuffer>> should
		// be reachable from the callback scope. The writer thread owns the
		// writer / buffer state exclusively.
		expect(recorderSource).not.toContain('Arc<Mutex<WavWriter>>');
		expect(recorderSource).not.toContain('Arc<Mutex<InMemoryAudioBuffer>>');

		// A dedicated writer thread must consume the capture channel.
		expect(recorderSource).toContain('spawn_writer_thread(');

		// Dropped batches must be counted in diagnostics so we can see when
		// the writer thread can't keep up with audio callbacks.
		expect(recorderSource).toContain('dropped_batches:');
		expect(recorderSource).toContain('record_dropped(');
	});
});
