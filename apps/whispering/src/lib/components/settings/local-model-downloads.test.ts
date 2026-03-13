import { describe, expect, mock, test } from 'bun:test';
import {
	getSharedLocalModelDownloadState,
	startSharedLocalModelDownload,
	subscribeSharedLocalModelDownload,
} from './local-model-downloads';

describe('shared local model downloads', () => {
	test('shares in-flight progress across subscribers and resets when finished', async () => {
		const updates = mock<(state: { isDownloading: boolean; progress: number }) => void>(
			() => undefined,
		);

		const releaseDownload = Promise.withResolvers<void>();
		const unsubscribe = subscribeSharedLocalModelDownload('parakeet', updates);

		const downloadPromise = startSharedLocalModelDownload(
			'parakeet',
			async (updateProgress) => {
				updateProgress(25);
				updateProgress(75);
				await releaseDownload.promise;
			},
		);
		await Promise.resolve();

		expect(getSharedLocalModelDownloadState('parakeet')).toEqual({
			isDownloading: true,
			progress: 75,
		});
		expect(updates.mock.calls).toEqual([
			[{ isDownloading: false, progress: 0 }],
			[{ isDownloading: true, progress: 0 }],
			[{ isDownloading: true, progress: 25 }],
			[{ isDownloading: true, progress: 75 }],
		]);

		releaseDownload.resolve();
		await downloadPromise;

		expect(getSharedLocalModelDownloadState('parakeet')).toEqual({
			isDownloading: false,
			progress: 0,
		});
		expect(updates.mock.calls.at(-1)).toEqual([
			{ isDownloading: false, progress: 0 },
		]);

		unsubscribe();
	});

	test('reuses the same in-flight download instead of starting a second one', async () => {
		const runDownload = mock(
			async (_updateProgress: (progress: number) => void) => {
				await Promise.resolve();
			},
		);

		const first = startSharedLocalModelDownload('parakeet', runDownload);
		const second = startSharedLocalModelDownload('parakeet', runDownload);

		expect(first).toBe(second);
		await first;
		expect(runDownload).toHaveBeenCalledTimes(1);
	});
});
