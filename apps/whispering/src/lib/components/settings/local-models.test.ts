import { describe, expect, test } from 'bun:test';
import type { LocalModelConfig } from '$lib/services/transcription/local/types';
import {
	clearCachedLocalModelValidity,
	downloadLocalModelToDestination,
	getCachedLocalModelValidity,
	validateConfiguredLocalModelPath,
	validateLocalModelInstall,
} from './local-models';

type FakeEntry =
	| { kind: 'dir' }
	| { kind: 'file'; data: Uint8Array };

function createFakeFs({
	renameFailures = [],
}: {
	renameFailures?: Array<{ from: string; to: string }>;
} = {}) {
	const entries = new Map<string, FakeEntry>();
	const writeCalls: string[] = [];
	const renameCalls: Array<{ from: string; to: string }> = [];
	const removeCalls: string[] = [];

	const normalize = (path: string) => path.replace(/\/+/g, '/');

	const ensureParentDirs = (path: string) => {
		const parts = normalize(path).split('/').filter(Boolean);
		let current = '';
		for (const part of parts.slice(0, -1)) {
			current += `/${part}`;
			if (!entries.has(current)) {
				entries.set(current, { kind: 'dir' });
			}
		}
	};

	return {
		entries,
		writeCalls,
		renameCalls,
		removeCalls,
		exists: async (path: string) => entries.has(normalize(path)),
		mkdir: async (path: string) => {
			const normalized = normalize(path);
			ensureParentDirs(normalized);
			entries.set(normalized, { kind: 'dir' });
		},
		writeFile: async (
			path: string,
			data: Uint8Array,
			options?: { append?: boolean },
		) => {
			const normalized = normalize(path);
			writeCalls.push(normalized);
			ensureParentDirs(normalized);
			const existing = entries.get(normalized);
			const currentData =
				options?.append && existing?.kind === 'file' ? existing.data : new Uint8Array();
			const next = new Uint8Array(currentData.length + data.length);
			next.set(currentData);
			next.set(data, currentData.length);
			entries.set(normalized, { kind: 'file', data: next });
		},
		stat: async (path: string) => {
			const entry = entries.get(normalize(path));
			if (!entry) throw new Error(`Missing path ${path}`);
			return {
				isDirectory: entry.kind === 'dir',
				size: entry.kind === 'file' ? entry.data.length : 0,
			};
		},
		remove: async (path: string) => {
			const normalized = normalize(path);
			removeCalls.push(normalized);
			for (const key of [...entries.keys()]) {
				if (key === normalized || key.startsWith(`${normalized}/`)) {
					entries.delete(key);
				}
			}
		},
		rename: async (from: string, to: string) => {
			const normalizedFrom = normalize(from);
			const normalizedTo = normalize(to);
			renameCalls.push({ from: normalizedFrom, to: normalizedTo });
			if (
				renameFailures.some(
					(failure) =>
						normalize(failure.from) === normalizedFrom &&
						normalize(failure.to) === normalizedTo,
				)
			) {
				throw new Error(`rename failed: ${normalizedFrom} -> ${normalizedTo}`);
			}
			ensureParentDirs(normalizedTo);
			const movedEntries = [...entries.entries()].filter(
				([key]) => key === normalizedFrom || key.startsWith(`${normalizedFrom}/`),
			);
			for (const [key, value] of movedEntries) {
				entries.delete(key);
				const renamedKey = key.replace(normalizedFrom, normalizedTo);
				entries.set(renamedKey, value);
			}
		},
		join: async (...parts: string[]) =>
			normalize(parts.join('/').replace(/\/+/g, '/')),
	};
}

function createResponse(chunks: string[]) {
	const encodedChunks = chunks.map((chunk) => new TextEncoder().encode(chunk));
	const totalLength = encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	let index = 0;

	return {
		ok: true,
		status: 200,
		headers: {
			get: (name: string) =>
				name === 'content-length' ? String(totalLength) : null,
		},
		body: {
			getReader: () => ({
				read: async () =>
					index < encodedChunks.length
						? { done: false, value: encodedChunks[index++] }
						: { done: true, value: undefined },
			}),
		},
	};
}

describe('local-models', () => {
	test('deleted or corrupt local model installs are not treated as configured', async () => {
		clearCachedLocalModelValidity();
		const fs = createFakeFs();
		const whisperModel: LocalModelConfig = {
			id: 'tiny',
			name: 'Tiny',
			description: 'Tiny whisper model',
			size: '78 MB',
			sizeBytes: 100,
			engine: 'whispercpp',
			file: {
				url: 'https://example.com/tiny.bin',
				filename: 'ggml-tiny.bin',
			},
		};
		const corruptedPath = '/models/whisper/ggml-tiny.bin';

		await fs.writeFile(corruptedPath, new Uint8Array(10));

		expect(
			await validateLocalModelInstall(whisperModel, corruptedPath, fs),
		).toBeFalse();
		expect(
			await validateConfiguredLocalModelPath('whispercpp', corruptedPath, fs),
		).toBeFalse();
		expect(getCachedLocalModelValidity(corruptedPath)).toBeFalse();
	});

	test('manually selected whisper models stay configured when the file exists outside the prebuilt catalog', async () => {
		clearCachedLocalModelValidity();
		const fs = createFakeFs();
		const manualModelPath = '/models/whisper/custom-medium-q5_0.gguf';

		await fs.writeFile(manualModelPath, new Uint8Array([1, 2, 3]));

		expect(
			await validateConfiguredLocalModelPath(
				'whispercpp',
				manualModelPath,
				fs,
				async () => true,
			),
		).toBeTrue();
		expect(getCachedLocalModelValidity(manualModelPath)).toBeTrue();
	});

	test('manually selected parakeet directories stay configured when they contain the required runtime files', async () => {
		clearCachedLocalModelValidity();
		const fs = createFakeFs();
		const manualModelPath = '/models/parakeet/custom-parakeet';

		await fs.mkdir(manualModelPath);
		await fs.writeFile(
			`${manualModelPath}/encoder-model.onnx`,
			new Uint8Array([1]),
		);
		await fs.writeFile(
			`${manualModelPath}/decoder_joint-model.onnx`,
			new Uint8Array([2]),
		);
		await fs.writeFile(`${manualModelPath}/nemo128.onnx`, new Uint8Array([3]));
		await fs.writeFile(`${manualModelPath}/vocab.txt`, new Uint8Array([4]));

		expect(
			await validateConfiguredLocalModelPath(
				'parakeet',
				manualModelPath,
				fs,
				async () => true,
			),
		).toBeTrue();
		expect(getCachedLocalModelValidity(manualModelPath)).toBeTrue();
	});

	test('manual model readiness follows the probe result instead of filesystem shape alone', async () => {
		clearCachedLocalModelValidity();
		const fs = createFakeFs();
		const manualModelPath = '/models/whisper/custom-medium-q5_0.gguf';

		await fs.writeFile(manualModelPath, new Uint8Array([1, 2, 3]));

		expect(
			await validateConfiguredLocalModelPath(
				'whispercpp',
				manualModelPath,
				fs,
				async () => false,
			),
		).toBeFalse();
		expect(getCachedLocalModelValidity(manualModelPath)).toBeFalse();
	});

	test('failed multi-file downloads clean up staged files and never activate the final directory', async () => {
		const fs = createFakeFs();
		const model: LocalModelConfig = {
			id: 'test-parakeet',
			name: 'Test Parakeet',
			description: 'Test multi-file model',
			size: '2 B',
			sizeBytes: 2,
			engine: 'parakeet',
			directoryName: 'test-parakeet',
			files: [
				{
					url: 'https://example.com/one',
					filename: 'one.bin',
					sizeBytes: 1,
				},
				{
					url: 'https://example.com/two',
					filename: 'two.bin',
					sizeBytes: 1,
				},
			],
		};
		const destinationPath = '/models/parakeet/test-parakeet';
		let fetchCalls = 0;

		await expect(
			downloadLocalModelToDestination({
				model,
				destinationPath,
				fs,
				fetchImpl: async () => {
					fetchCalls += 1;
					if (fetchCalls === 1) return createResponse(['a']);
					throw new Error('network boom');
				},
				onProgress: () => undefined,
			}),
		).rejects.toThrow('network boom');

		expect(await fs.exists(destinationPath)).toBeFalse();
		expect(
			[...fs.entries.keys()].some((path) => path.includes('.download-')),
		).toBeFalse();
		expect(fs.removeCalls.some((path) => path.includes('.download-'))).toBeTrue();
	});

	test('downloads stage to temporary paths before activation', async () => {
		const fs = createFakeFs();
		const model: LocalModelConfig = {
			id: 'tiny',
			name: 'Tiny',
			description: 'Tiny whisper model',
			size: '1 B',
			sizeBytes: 1,
			engine: 'whispercpp',
			file: {
				url: 'https://example.com/tiny.bin',
				filename: 'ggml-tiny.bin',
			},
		};
		const destinationPath = '/models/whisper/ggml-tiny.bin';

		await downloadLocalModelToDestination({
			model,
			destinationPath,
			fs,
			fetchImpl: async () => createResponse(['a']),
			onProgress: () => undefined,
		});

		expect(
			fs.writeCalls.every((path) => path.includes('.download-')),
		).toBeTrue();
		expect(fs.renameCalls).toEqual([
			{
				from: '/models/whisper/ggml-tiny.bin.download-tiny',
				to: destinationPath,
			},
		]);
		expect(await fs.exists(destinationPath)).toBeTrue();
	});

	test('failed promotion keeps the existing installed model intact', async () => {
		const destinationPath = '/models/whisper/ggml-tiny.bin';
		const fs = createFakeFs({
			renameFailures: [
				{
					from: '/models/whisper/ggml-tiny.bin.download-tiny',
					to: destinationPath,
				},
			],
		});
		const model: LocalModelConfig = {
			id: 'tiny',
			name: 'Tiny',
			description: 'Tiny whisper model',
			size: '1 B',
			sizeBytes: 1,
			engine: 'whispercpp',
			file: {
				url: 'https://example.com/tiny.bin',
				filename: 'ggml-tiny.bin',
			},
		};

		await fs.writeFile(destinationPath, new Uint8Array([7]));

		await expect(
			downloadLocalModelToDestination({
				model,
				destinationPath,
				fs,
				fetchImpl: async () => createResponse(['a']),
				onProgress: () => undefined,
			}),
		).rejects.toThrow(
			'rename failed: /models/whisper/ggml-tiny.bin.download-tiny -> /models/whisper/ggml-tiny.bin',
		);

		expect(await fs.exists(destinationPath)).toBeTrue();
		expect(await fs.stat(destinationPath)).toMatchObject({
			isDirectory: false,
			size: 1,
		});
		expect(
			[...fs.entries.keys()].some((path) => path.includes('.download-')),
		).toBeFalse();
	});
});
