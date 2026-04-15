import { invoke } from '@tauri-apps/api/core';
import { exists, stat } from '@tauri-apps/plugin-fs';
import { type } from 'arktype';
import { extractErrorMessage } from 'wellcrafted/error';
import { Ok, type Result, tryAsync } from 'wellcrafted/result';
import { WhisperingErr, type WhisperingError } from '$lib/result';
import type {
	AcceleratorAvailability,
	DirectMlAdapter,
	ParakeetAccelerationMode,
	ParakeetModelConfig,
} from './types';

/**
 * Pre-built Parakeet models available for download from GitHub releases.
 * These are NVIDIA NeMo models consisting of multiple ONNX files.
 */
export const PARAKEET_MODELS = [
	{
		id: 'parakeet-tdt-0.6b-v3-int8',
		name: 'Parakeet TDT 0.6B v3 (INT8)',
		description: 'Fast and accurate NVIDIA NeMo model',
		size: '~670 MB',
		sizeBytes: 670_619_803, // Total size of all individual files
		engine: 'parakeet',
		directoryName: 'parakeet-tdt-0.6b-v3-int8',
		files: [
			{
				url: 'https://github.com/EpicenterHQ/epicenter/releases/download/models/parakeet-tdt-0.6b-v3-int8/config.json',
				filename: 'config.json',
				sizeBytes: 97,
			},
			{
				url: 'https://github.com/EpicenterHQ/epicenter/releases/download/models/parakeet-tdt-0.6b-v3-int8/decoder_joint-model.int8.onnx',
				filename: 'decoder_joint-model.int8.onnx',
				sizeBytes: 18_202_004,
			},
			{
				url: 'https://github.com/EpicenterHQ/epicenter/releases/download/models/parakeet-tdt-0.6b-v3-int8/encoder-model.int8.onnx',
				filename: 'encoder-model.int8.onnx',
				sizeBytes: 652_183_999,
			},
			{
				url: 'https://github.com/EpicenterHQ/epicenter/releases/download/models/parakeet-tdt-0.6b-v3-int8/nemo128.onnx',
				filename: 'nemo128.onnx',
				sizeBytes: 139_764,
			},
			{
				url: 'https://github.com/EpicenterHQ/epicenter/releases/download/models/parakeet-tdt-0.6b-v3-int8/vocab.txt',
				filename: 'vocab.txt',
				sizeBytes: 93_939,
			},
		],
	},
] as const satisfies readonly ParakeetModelConfig[];

const ParakeetErrorType = type({
	name: "'AudioReadError' | 'FfmpegNotFoundError' | 'GpuError' | 'ModelLoadError' | 'TranscriptionError'",
	message: 'string',
});

export const ParakeetTranscriptionServiceLive = {
	async listDirectMLAdapters(): Promise<
		Result<DirectMlAdapter[], WhisperingError>
	> {
		if (!window.__TAURI_INTERNALS__) {
			return Ok([]);
		}

		return await tryAsync({
			try: () => invoke<DirectMlAdapter[]>('list_directml_adapters'),
			catch: (unknownError) =>
				WhisperingErr({
					title: '🖥️ Unable to list GPU adapters',
					description: extractErrorMessage(unknownError),
					action: { type: 'more-details', error: unknownError },
				}),
		});
	},

	/**
	 * Probe which Parakeet acceleration modes actually work on this box.
	 * Used by the settings UI to disable radio options the user can't run
	 * (no DX12 adapter → DirectML unavailable; no CUDA+TensorRT libs →
	 * TensorRT unavailable). CPU is always reported available.
	 */
	async probeAccelerators(): Promise<
		Result<AcceleratorAvailability, WhisperingError>
	> {
		if (!window.__TAURI_INTERNALS__) {
			return Ok({
				cpu: true,
				directml: {
					available: false,
					reason: 'DirectML requires a desktop Windows build.',
				},
				tensorrt: {
					available: false,
					reason: 'TensorRT requires a desktop Windows build.',
				},
			});
		}

		return await tryAsync({
			try: () =>
				invoke<AcceleratorAvailability>('probe_parakeet_accelerators'),
			catch: (unknownError) =>
				WhisperingErr({
					title: '🖥️ Unable to probe acceleration support',
					description: extractErrorMessage(unknownError),
					action: { type: 'more-details', error: unknownError },
				}),
		});
	},

	async transcribe(
		audioBlob: Blob,
		options: {
			modelPath: string;
			accelerationMode: ParakeetAccelerationMode;
			deviceId?: number | null;
		},
	): Promise<Result<string, WhisperingError>> {
		// Pre-validation
		if (!options.modelPath) {
			return WhisperingErr({
				title: '📁 Model Directory Required',
				description: 'Please select a Parakeet model directory in settings.',
				action: {
					type: 'link',
					label: 'Configure model',
					href: '/settings/transcription',
				},
			});
		}

		// Check if model directory exists
		const { data: isExists } = await tryAsync({
			try: () => exists(options.modelPath),
			catch: () => Ok(false),
		});

		if (!isExists) {
			return WhisperingErr({
				title: '❌ Model Directory Not Found',
				description: `The model directory "${options.modelPath}" does not exist.`,
				action: {
					type: 'link',
					label: 'Select model',
					href: '/settings/transcription',
				},
			});
		}

		// Check if it's actually a directory
		const { data: stats } = await tryAsync({
			try: () => stat(options.modelPath),
			catch: () => Ok(null),
		});

		if (!stats || !stats.isDirectory) {
			return WhisperingErr({
				title: '❌ Invalid Model Path',
				description:
					'Parakeet models must be directories containing model files.',
				action: {
					type: 'link',
					label: 'Select model directory',
					href: '/settings/transcription',
				},
			});
		}

		// Convert audio blob to byte array
		const arrayBuffer = await audioBlob.arrayBuffer();
		const audioData = Array.from(new Uint8Array(arrayBuffer));

		// Call Tauri command to transcribe with Parakeet
		// Note: Parakeet doesn't support language selection, temperature, or prompt
		const result = await tryAsync({
			try: () =>
				invoke<string>('transcribe_audio_parakeet', {
					audioData: audioData,
					modelPath: options.modelPath,
					accelerationMode: options.accelerationMode,
					deviceId: options.deviceId ?? null,
				}),
			catch: (unknownError) => {
				const result = ParakeetErrorType(unknownError);
				if (result instanceof type.errors) {
					return WhisperingErr({
						title: '❌ Unexpected Parakeet Error',
						description: extractErrorMessage(unknownError),
						action: { type: 'more-details', error: unknownError },
					});
				}
				const error = result;

				switch (error.name) {
					case 'ModelLoadError':
						return WhisperingErr({
							title: '🤖 Model Loading Error',
							description: error.message,
							action: {
								type: 'more-details',
								error: new Error(error.message),
							},
						});

					case 'GpuError':
						return WhisperingErr({
							title: '🖥️ GPU Acceleration Error',
							description: error.message,
							action: {
								type: 'more-details',
								error: new Error(error.message),
							},
						});

					case 'FfmpegNotFoundError':
						return WhisperingErr({
							title: '🛠️ FFmpeg Not Installed',
							description:
								'Parakeet requires FFmpeg to convert audio formats. Please install FFmpeg or switch to CPAL recording at 16kHz.',
							action: {
								type: 'link',
								label: 'Install FFmpeg',
								href: '/install-ffmpeg',
							},
						});

					case 'AudioReadError':
						return WhisperingErr({
							title: '🔊 Audio Read Error',
							description: error.message,
							action: {
								type: 'more-details',
								error: new Error(error.message),
							},
						});

					case 'TranscriptionError':
						return WhisperingErr({
							title: '❌ Transcription Error',
							description: error.message,
							action: {
								type: 'more-details',
								error: new Error(error.message),
							},
						});

					default:
						return WhisperingErr({
							title: '❌ Parakeet Error',
							description: 'An unexpected error occurred.',
							action: {
								type: 'more-details',
								error: new Error(String(error)),
							},
						});
				}
			},
		});

		return result;
	},
};

export type ParakeetTranscriptionService =
	typeof ParakeetTranscriptionServiceLive;
