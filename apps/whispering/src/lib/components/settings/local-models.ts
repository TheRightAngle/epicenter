import { invoke } from '@tauri-apps/api/core';
import { join as tauriJoin } from '@tauri-apps/api/path';
import {
	exists as tauriExists,
	mkdir as tauriMkdir,
	remove as tauriRemove,
	rename as tauriRename,
	stat as tauriStat,
	writeFile as tauriWriteFile,
} from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
	isModelFileSizeValid,
	type LocalModelConfig,
	MOONSHINE_LANGUAGES,
	MOONSHINE_VARIANTS,
} from '../../services/transcription/local/types';
import type { TranscriptionService } from '../../services/transcription/registry';

type FileInfo = {
	isDirectory: boolean;
	size: number;
};

type FsDeps = {
	exists(path: string): Promise<boolean>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	remove(path: string, options?: { recursive?: boolean }): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	stat(path: string): Promise<FileInfo>;
	writeFile(
		path: string,
		data: Uint8Array,
		options?: { append?: boolean },
	): Promise<void>;
	join(...parts: string[]): Promise<string>;
};

type FetchResponse = {
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	body?: {
		getReader(): {
			read(): Promise<{ done: boolean; value?: Uint8Array }>;
		};
	} | null;
};

type DownloadDeps = FsDeps & {
	fetchImpl(url: string): Promise<FetchResponse>;
};

type ProbeModelInstall = (
	serviceId: TranscriptionService['id'],
	modelPath: string,
) => Promise<boolean>;

type InstalledWhisperCatalogEntry = {
	id: string;
	engine: 'whispercpp';
	sizeBytes: number;
	file: { filename: string };
};

type InstalledDirectoryCatalogEntry = {
	id: string;
	engine: 'parakeet' | 'moonshine';
	sizeBytes: number;
	directoryName: string;
	language?: string;
	files: Array<{ filename: string; sizeBytes: number }>;
};

type ValidatableLocalModel =
	| LocalModelConfig
	| InstalledWhisperCatalogEntry
	| InstalledDirectoryCatalogEntry;

const WHISPER_MODEL_CATALOG = [
	{
		id: 'tiny',
		engine: 'whispercpp',
		sizeBytes: 77_691_713,
		file: { filename: 'ggml-tiny.bin' },
	},
	{
		id: 'small',
		engine: 'whispercpp',
		sizeBytes: 487_601_967,
		file: { filename: 'ggml-small.bin' },
	},
	{
		id: 'medium',
		engine: 'whispercpp',
		sizeBytes: 1_533_763_059,
		file: { filename: 'ggml-medium.bin' },
	},
	{
		id: 'large-v3-turbo',
		engine: 'whispercpp',
		sizeBytes: 1_624_555_275,
		file: { filename: 'ggml-large-v3-turbo.bin' },
	},
] as const satisfies readonly InstalledWhisperCatalogEntry[];

const PARAKEET_MODEL_CATALOG = [
	{
		id: 'parakeet-tdt-0.6b-v3-int8',
		engine: 'parakeet',
		sizeBytes: 670_619_803,
		directoryName: 'parakeet-tdt-0.6b-v3-int8',
		files: [
			{ filename: 'config.json', sizeBytes: 97 },
			{ filename: 'decoder_joint-model.int8.onnx', sizeBytes: 18_202_004 },
			{ filename: 'encoder-model.int8.onnx', sizeBytes: 652_183_999 },
			{ filename: 'nemo128.onnx', sizeBytes: 139_764 },
			{ filename: 'vocab.txt', sizeBytes: 93_939 },
		],
	},
] as const satisfies readonly InstalledDirectoryCatalogEntry[];

const MOONSHINE_MODEL_CATALOG = [
	{
		id: 'moonshine-tiny-en',
		engine: 'moonshine',
		sizeBytes: 30_166_481,
		language: 'en',
		directoryName: 'moonshine-tiny-en',
		files: [
			{ filename: 'encoder_model.onnx', sizeBytes: 7_937_661 },
			{ filename: 'decoder_model_merged.onnx', sizeBytes: 20_243_286 },
			{ filename: 'tokenizer.json', sizeBytes: 1_985_534 },
		],
	},
	{
		id: 'moonshine-base-en',
		engine: 'moonshine',
		sizeBytes: 64_997_467,
		language: 'en',
		directoryName: 'moonshine-base-en',
		files: [
			{ filename: 'encoder_model.onnx', sizeBytes: 20_513_063 },
			{ filename: 'decoder_model_merged.onnx', sizeBytes: 42_498_870 },
			{ filename: 'tokenizer.json', sizeBytes: 1_985_534 },
		],
	},
] as const satisfies readonly InstalledDirectoryCatalogEntry[];

const defaultFsDeps: FsDeps = {
	exists: tauriExists,
	mkdir: tauriMkdir,
	remove: tauriRemove,
	rename: tauriRename,
	stat: tauriStat,
	writeFile: tauriWriteFile,
	join: tauriJoin,
};

const defaultProbeModelInstall: ProbeModelInstall = async (
	serviceId,
	modelPath,
) => {
	if (!window.__TAURI_INTERNALS__) {
		return false;
	}

	try {
		await invoke('validate_local_transcription_model', {
			serviceId,
			modelPath,
		});
		return true;
	} catch {
		return false;
	}
};

const localModelValidityCache = new Map<string, boolean>();

const localModelCatalog = {
	whispercpp: WHISPER_MODEL_CATALOG,
	parakeet: PARAKEET_MODEL_CATALOG,
	moonshine: MOONSHINE_MODEL_CATALOG,
} as const;

const VALID_WHISPER_MODEL_EXTENSIONS = ['.bin', '.gguf', '.ggml'] as const;

const MOONSHINE_DIRECTORY_NAME_PATTERN = new RegExp(
	`^moonshine-(${MOONSHINE_VARIANTS.join('|')})-(${MOONSHINE_LANGUAGES.join('|')})$`,
);

export function getCachedLocalModelValidity(path: string): boolean {
	return localModelValidityCache.get(path) === true;
}

export function clearCachedLocalModelValidity(path?: string) {
	if (path) {
		localModelValidityCache.delete(path);
		return;
	}
	localModelValidityCache.clear();
}

export async function validateConfiguredLocalModelPath(
	serviceId: TranscriptionService['id'],
	modelPath: string,
	fs: FsDeps = defaultFsDeps,
	probeModelInstall: ProbeModelInstall = defaultProbeModelInstall,
): Promise<boolean> {
	if (!modelPath) {
		clearCachedLocalModelValidity(modelPath);
		return false;
	}

	const model = findInstalledLocalModel(serviceId, modelPath);
	const passesPreflight = model
		? await validateLocalModelInstall(model, modelPath, fs)
		: await validateManualLocalModelShape(serviceId, modelPath, fs);
	if (!passesPreflight) {
		localModelValidityCache.set(modelPath, false);
		return false;
	}

	const isValid = await probeModelInstall(serviceId, modelPath);
	localModelValidityCache.set(modelPath, isValid);
	return isValid;
}

export async function validateLocalModelInstall(
	model: ValidatableLocalModel,
	path: string,
	fs: FsDeps = defaultFsDeps,
): Promise<boolean> {
	switch (model.engine) {
		case 'whispercpp': {
			if (!(await fs.exists(path))) return false;
			const stats = await safeStat(path, fs);
			if (!stats || stats.isDirectory) return false;
			return isModelFileSizeValid(stats.size, model.sizeBytes);
		}
		case 'parakeet':
		case 'moonshine': {
			if (!(await fs.exists(path))) return false;
			const dirStats = await safeStat(path, fs);
			if (!dirStats?.isDirectory) return false;

			for (const file of model.files) {
				const filePath = await fs.join(path, file.filename);
				if (!(await fs.exists(filePath))) return false;
				const fileStats = await safeStat(filePath, fs);
				if (!fileStats || fileStats.isDirectory) return false;
				if (!isModelFileSizeValid(fileStats.size, file.sizeBytes)) return false;
			}

			return true;
		}
	}
}

export async function downloadLocalModelToDestination({
	model,
	destinationPath,
	onProgress,
	fs = defaultFsDeps,
	fetchImpl = tauriFetch as DownloadDeps['fetchImpl'],
}: {
	model: LocalModelConfig;
	destinationPath: string;
	onProgress(progress: number): void;
	fs?: FsDeps;
	fetchImpl?: DownloadDeps['fetchImpl'];
}): Promise<void> {
	const deps: DownloadDeps = {
		...fs,
		fetchImpl,
	};
	const stagingPath = `${destinationPath}.download-${model.id}`;
	const backupPath = `${destinationPath}.rollback-${model.id}`;
	const isDirectoryModel = model.engine !== 'whispercpp';

	await cleanupPath(stagingPath, isDirectoryModel, deps);
	await cleanupPath(backupPath, isDirectoryModel, deps);

	if (
		await deps.exists(destinationPath) &&
		!(await validateLocalModelInstall(model, destinationPath, deps))
	) {
		await cleanupPath(destinationPath, isDirectoryModel, deps);
	}

	try {
		switch (model.engine) {
			case 'whispercpp': {
				await downloadFileToPath({
					url: model.file.url,
					sizeBytes: model.sizeBytes,
					filePath: stagingPath,
					deps,
					onProgress,
				});
				break;
			}
			case 'parakeet':
			case 'moonshine': {
				await deps.mkdir(stagingPath, { recursive: true });
				let downloadedBytes = 0;

				for (const file of model.files) {
					const filePath = await deps.join(stagingPath, file.filename);
					await downloadFileToPath({
						url: file.url,
						sizeBytes: file.sizeBytes,
						filePath,
						deps,
						onProgress: (fileProgress) => {
							const overallProgress = Math.round(
								((downloadedBytes + (file.sizeBytes * fileProgress) / 100) /
									model.sizeBytes) *
									100,
							);
							onProgress(overallProgress);
						},
					});
					downloadedBytes += file.sizeBytes;
				}
				break;
			}
		}

		if (!(await validateLocalModelInstall(model, stagingPath, deps))) {
			throw new Error('Downloaded model did not pass validation.');
		}

		let hasBackup = false;
		if (await deps.exists(destinationPath)) {
			await deps.rename(destinationPath, backupPath);
			hasBackup = true;
		}

		try {
			await deps.rename(stagingPath, destinationPath);
		} catch (promotionError) {
			await restoreDownloadedModelBackup({
				destinationPath,
				backupPath,
				hasBackup,
				isDirectoryModel,
				fs: deps,
			});
			throw promotionError;
		}

		if (hasBackup) {
			await cleanupPath(backupPath, isDirectoryModel, deps);
		}

		clearCachedLocalModelValidity(destinationPath);
	} catch (error) {
		await cleanupPath(stagingPath, isDirectoryModel, deps);
		if (await deps.exists(destinationPath)) {
			clearCachedLocalModelValidity(destinationPath);
		} else {
			localModelValidityCache.set(destinationPath, false);
		}
		throw error;
	}
}

function findInstalledLocalModel(
	serviceId: TranscriptionService['id'],
	modelPath: string,
): ValidatableLocalModel | undefined {
	const pathTail = getPathTail(modelPath);

	switch (serviceId) {
		case 'whispercpp':
			return localModelCatalog.whispercpp.find(
				(model) => model.file.filename === pathTail,
			);
		case 'parakeet':
			return localModelCatalog.parakeet.find(
				(model) => model.directoryName === pathTail,
			);
		case 'moonshine':
			return localModelCatalog.moonshine.find(
				(model) => model.directoryName === pathTail,
			);
		default:
			return undefined;
	}
}

function getPathTail(path: string) {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

async function safeStat(path: string, fs: FsDeps) {
	try {
		return await fs.stat(path);
	} catch {
		return null;
	}
}

async function cleanupPath(
	path: string,
	recursive: boolean,
	fs: FsDeps,
) {
	if (!(await fs.exists(path))) return;
	await fs.remove(path, { recursive });
}

async function restoreDownloadedModelBackup({
	destinationPath,
	backupPath,
	hasBackup,
	isDirectoryModel,
	fs,
}: {
	destinationPath: string;
	backupPath: string;
	hasBackup: boolean;
	isDirectoryModel: boolean;
	fs: FsDeps;
}) {
	if (!hasBackup) {
		return;
	}

	if (await fs.exists(destinationPath)) {
		await cleanupPath(destinationPath, isDirectoryModel, fs);
	}

	if (await fs.exists(backupPath)) {
		await fs.rename(backupPath, destinationPath);
	}
}

async function validateManualLocalModelShape(
	serviceId: TranscriptionService['id'],
	path: string,
	fs: FsDeps,
): Promise<boolean> {
	switch (serviceId) {
		case 'whispercpp':
			return await validateManualWhisperModel(path, fs);
		case 'parakeet':
			return await validateManualParakeetModel(path, fs);
		case 'moonshine':
			return await validateManualMoonshineModel(path, fs);
		default:
			return false;
	}
}

async function validateManualWhisperModel(path: string, fs: FsDeps) {
	if (!(await fs.exists(path))) return false;
	const stats = await safeStat(path, fs);
	if (!stats || stats.isDirectory || stats.size <= 0) return false;

	const normalizedPath = path.toLowerCase();
	return VALID_WHISPER_MODEL_EXTENSIONS.some((extension) =>
		normalizedPath.endsWith(extension),
	);
}

async function validateManualParakeetModel(path: string, fs: FsDeps) {
	return await validateRuntimeFileSet(
		path,
		[
			['encoder-model.int8.onnx', 'encoder-model.fp16.onnx', 'encoder-model.onnx'],
			[
				'decoder_joint-model.int8.onnx',
				'decoder_joint-model.fp16.onnx',
				'decoder_joint-model.onnx',
			],
			['nemo128.onnx'],
			['vocab.txt'],
		],
		fs,
	);
}

async function validateManualMoonshineModel(path: string, fs: FsDeps) {
	if (!MOONSHINE_DIRECTORY_NAME_PATTERN.test(getPathTail(path))) {
		return false;
	}

	return await validateRuntimeFileSet(
		path,
		[
			['encoder_model.fp16.onnx', 'encoder_model.onnx'],
			['decoder_model_merged.fp16.onnx', 'decoder_model_merged.onnx'],
			['tokenizer.json'],
		],
		fs,
	);
}

async function validateRuntimeFileSet(
	directoryPath: string,
	requiredFileGroups: ReadonlyArray<ReadonlyArray<string>>,
	fs: FsDeps,
) {
	if (!(await fs.exists(directoryPath))) return false;
	const directoryStats = await safeStat(directoryPath, fs);
	if (!directoryStats?.isDirectory) return false;

	for (const fileGroup of requiredFileGroups) {
		let hasValidFile = false;
		for (const filename of fileGroup) {
			const filePath = await fs.join(directoryPath, filename);
			if (!(await fs.exists(filePath))) {
				continue;
			}

			const fileStats = await safeStat(filePath, fs);
			if (fileStats && !fileStats.isDirectory && fileStats.size > 0) {
				hasValidFile = true;
				break;
			}
		}

		if (!hasValidFile) {
			return false;
		}
	}

	return true;
}

async function downloadFileToPath({
	url,
	sizeBytes,
	filePath,
	deps,
	onProgress,
}: {
	url: string;
	sizeBytes: number;
	filePath: string;
	deps: DownloadDeps;
	onProgress(progress: number): void;
}) {
	const response = await deps.fetchImpl(url);
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.status}`);
	}

	const contentLength = response.headers.get('content-length');
	const totalBytes = contentLength
		? Number.parseInt(contentLength, 10)
		: sizeBytes;

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Failed to read response body');
	}

	await deps.writeFile(filePath, new Uint8Array());

	let downloadedBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;

		await deps.writeFile(filePath, value, { append: true });
		downloadedBytes += value.length;
		onProgress(Math.round((downloadedBytes / totalBytes) * 100));
	}

	if (downloadedBytes < totalBytes) {
		throw new Error(
			`Download incomplete: received ${downloadedBytes} bytes but expected ${totalBytes} bytes.`,
		);
	}
}
