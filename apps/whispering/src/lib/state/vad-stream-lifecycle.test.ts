import { describe, expect, test } from 'bun:test';
import { createVadStreamLifecycle } from './vad-stream-lifecycle';

describe('createVadStreamLifecycle', () => {
	test('reuses the validated initial stream, cleans it on pause, and reacquires on resume', async () => {
		const initialStream = { id: 'initial' } as MediaStream;
		const resumedStream = { id: 'resumed' } as MediaStream;
		const cleaned: MediaStream[] = [];
		const current: Array<MediaStream | null> = [];

		const lifecycle = createVadStreamLifecycle({
			initialStream,
			cleanupStream: (stream) => {
				cleaned.push(stream);
			},
			setCurrentStream: (stream) => {
				current.push(stream);
			},
			reacquireStream: async () => resumedStream,
		});

		await expect(lifecycle.getStream()).resolves.toBe(initialStream);

		await lifecycle.pauseStream(initialStream);
		expect(cleaned).toEqual([initialStream]);
		expect(current).toEqual([initialStream, null]);

		await expect(lifecycle.resumeStream()).resolves.toBe(resumedStream);
		expect(current).toEqual([initialStream, null, resumedStream]);
	});
});
