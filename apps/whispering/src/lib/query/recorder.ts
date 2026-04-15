import { nanoid } from 'nanoid/non-secure';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { Ok } from 'wellcrafted/result';
import type { WhisperingRecordingState } from '$lib/constants/audio';
import { PATHS } from '$lib/constants/paths';
import { defineMutation, defineQuery, queryClient } from '$lib/query/client';
import { WhisperingErr } from '$lib/result';
import { services } from '$lib/services';
import { desktopServices } from '$lib/services/desktop';
import { getFileExtensionFromFfmpegOptions } from '$lib/services/desktop/recorder/ffmpeg';
import type { Device, DeviceIdentifier } from '$lib/services/types';
import { asDeviceIdentifier } from '$lib/services/types';
import { deviceConfig } from '$lib/state/device-config.svelte';
import { settings } from '$lib/state/settings.svelte';
import { disambiguateDeviceLabels } from '../services/device-labels';
import { notify } from './notify';

type RecordingMethod = 'cpal' | 'ffmpeg' | 'navigator';

const recorderKeys = {
	recorderState: ['recorder', 'recorderState'] as const,
	devices: (method: RecordingMethod) =>
		['recorder', 'devices', method] as const,
	startRecording: ['recorder', 'startRecording'] as const,
	stopRecording: ['recorder', 'stopRecording'] as const,
	cancelRecording: ['recorder', 'cancelRecording'] as const,
} as const;

/**
 * Module-level state to track the current recording ID.
 * This ensures the same ID is used from recording start through database save.
 */
let currentRecordingId: string | null = null;
let currentRecordingSourceFilePath: string | null = null;

const invalidateRecorderState = () =>
	queryClient.invalidateQueries({ queryKey: recorderKeys.recorderState });

function parseDeviceId(deviceId: string | null): DeviceIdentifier | null {
	if (!deviceId) return null;
	return asDeviceIdentifier(deviceId);
}

function hasDuplicateDeviceLabels(devices: Device[]) {
	const labels = devices.map((device) => device.label.toLowerCase());
	return new Set(labels).size !== labels.length;
}

function filterNavigatorAliasDevices(devices: Device[] | undefined) {
	if (!devices) return undefined;

	return devices.filter((device) => {
		const id = String(device.id).toLowerCase();
		const label = device.label.toLowerCase();

		if (id === 'default' || id === 'communications') return false;
		if (label.startsWith('default - ') || label.startsWith('communications - ')) {
			return false;
		}

		return true;
	});
}

async function resolveDesktopSourceFilePath(
	recordingId: string,
): Promise<string | null> {
	if (!window.__TAURI_INTERNALS__) return null;
	const { join } = await import('@tauri-apps/api/path');

	const outputFolder =
		deviceConfig.get('recording.cpal.outputFolder') ??
		(await PATHS.DB.RECORDINGS());

	switch (deviceConfig.get('recording.method')) {
		case 'cpal':
			return await join(outputFolder, `${recordingId}.wav`);
		case 'ffmpeg': {
			const extension = getFileExtensionFromFfmpegOptions(
				deviceConfig.get('recording.ffmpeg.outputOptions'),
			);
			return await join(outputFolder, `${recordingId}.${extension}`);
		}
		case 'navigator':
			return null;
	}
}

function getEffectiveRecordingMethod(
	method: RecordingMethod = deviceConfig.get('recording.method'),
): RecordingMethod {
	return window.__TAURI_INTERNALS__ ? method : 'navigator';
}

async function enumerateDevicesForMethod(
	method: RecordingMethod = deviceConfig.get('recording.method'),
) {
	const effectiveMethod = getEffectiveRecordingMethod(method);
	const { data, error } =
		await recorderServiceForMethod(effectiveMethod).enumerateDevices();
	if (error) {
		return WhisperingErr({
			title: '❌ Failed to enumerate devices',
			serviceError: error,
		});
	}

	let richerDevices: Device[] | undefined;

	if (
		window.__TAURI_INTERNALS__ &&
		effectiveMethod !== 'navigator' &&
		hasDuplicateDeviceLabels(data)
	) {
		const { data: navigatorDevices } =
			await services.navigatorRecorder.enumerateDevices();
		richerDevices = filterNavigatorAliasDevices(
			navigatorDevices ?? undefined,
		);
	}

	return Ok(disambiguateDeviceLabels(data, richerDevices));
}

export const recorder = {
	// Query that enumerates available recording devices with labels
	get enumerateDevices() {
		const method = getEffectiveRecordingMethod();
		return defineQuery({
			queryKey: recorderKeys.devices(method),
			queryFn: async () => await enumerateDevicesForMethod(method),
		});
	},

	// Query that returns the recorder state (IDLE or RECORDING)
	getRecorderState: defineQuery({
		queryKey: recorderKeys.recorderState,
		queryFn: async () => {
			const { data: state, error: getStateError } =
				await recorderService().getRecorderState();
			if (getStateError) {
				return WhisperingErr({
					title: '❌ Failed to get recorder state',
					serviceError: getStateError,
				});
			}
			return Ok(state);
		},
		initialData: 'IDLE' as WhisperingRecordingState,
	}),

	startRecording: defineMutation({
		mutationKey: recorderKeys.startRecording,
		mutationFn: async ({ toastId }: { toastId: string }) => {
			try {
				// Generate a unique recording ID that will serve as the file name
				const recordingId = nanoid();

				// Store the recording ID so it can be reused when stopping
				currentRecordingId = recordingId;

				// Prepare recording parameters based on which method we're using
				const baseParams = {
					recordingId,
				};

				// Resolve the output folder - use default if null
				const outputFolder = window.__TAURI_INTERNALS__
					? (deviceConfig.get('recording.cpal.outputFolder') ??
						(await PATHS.DB.RECORDINGS()))
					: '';

				const paramsMap = {
					navigator: {
						...baseParams,
						method: 'navigator' as const,
						selectedDeviceId: parseDeviceId(
							deviceConfig.get('recording.navigator.deviceId'),
						),
						bitrateKbps: deviceConfig.get('recording.navigator.bitrateKbps'),
					},
					ffmpeg: {
						...baseParams,
						method: 'ffmpeg' as const,
						selectedDeviceId: parseDeviceId(
							deviceConfig.get('recording.ffmpeg.deviceId'),
						),
						globalOptions: deviceConfig.get('recording.ffmpeg.globalOptions'),
						inputOptions: deviceConfig.get('recording.ffmpeg.inputOptions'),
						outputOptions: deviceConfig.get('recording.ffmpeg.outputOptions'),
						outputFolder,
					},
					cpal: {
						...baseParams,
						method: 'cpal' as const,
						selectedDeviceId: parseDeviceId(
							deviceConfig.get('recording.cpal.deviceId'),
						),
						outputFolder,
						sampleRate: deviceConfig.get('recording.cpal.sampleRate'),
						bufferedCapture: deviceConfig.get(
							'recording.cpal.bufferedCapture',
						),
					},
				} as const;

				const params =
					paramsMap[
						!window.__TAURI_INTERNALS__
							? 'navigator'
							: deviceConfig.get('recording.method')
					];
				currentRecordingSourceFilePath =
					params.method === 'cpal' && params.bufferedCapture
						? null
						: await resolveDesktopSourceFilePath(recordingId);

				const { data: deviceAcquisitionOutcome, error: startRecordingError } =
					await recorderService().startRecording(params, {
						sendStatus: (options) => notify.loading({ id: toastId, ...options }),
					});

				if (startRecordingError) {
					currentRecordingId = null;
					currentRecordingSourceFilePath = null;
					return WhisperingErr({
						title: '❌ Failed to start recording',
						serviceError: startRecordingError,
					});
				}
				return Ok(deviceAcquisitionOutcome);
			} catch (error) {
				currentRecordingId = null;
				currentRecordingSourceFilePath = null;
				return WhisperingErr({
					title: '❌ Failed to start recording',
					description:
						error instanceof Error ? error.message : 'Unknown start recording error.',
				});
			}
		},
		onSettled: invalidateRecorderState,
	}),

	stopRecording: defineMutation({
		mutationKey: recorderKeys.stopRecording,
		mutationFn: async ({ toastId }: { toastId: string }) => {
			let recordingId = currentRecordingId;
			if (!recordingId) {
				const {
					recordingId: recoveredRecordingId,
					lookupError,
				} = await recoverDesktopCpalRecordingId();
				if (lookupError) {
					return WhisperingErr({
						title: '❌ Failed to recover recording ID',
						description: lookupError,
					});
				}
				recordingId = recoveredRecordingId;
			}
			if (!recordingId) {
				currentRecordingId = null;
				currentRecordingSourceFilePath = null;
				return WhisperingErr({
					title: '❌ Missing recording ID',
					description:
						'An internal error occurred: recording ID was not set when stopping the recording.',
				});
			}

			currentRecordingId = recordingId;
			if (!currentRecordingSourceFilePath) {
				currentRecordingSourceFilePath =
					await resolveDesktopSourceFilePath(recordingId);
			}
			const { data: blob, error: stopRecordingError } =
				await recorderService().stopRecording({
					sendStatus: (options) => notify.loading({ id: toastId, ...options }),
				});

			if (stopRecordingError) {
				if (isDesktopCpalContext()) {
					currentRecordingId = null;
					currentRecordingSourceFilePath = null;
				}
				return WhisperingErr({
					title: '❌ Failed to stop recording',
					serviceError: stopRecordingError,
				});
			}

			const sourceFilePath = currentRecordingSourceFilePath;
			currentRecordingId = null;
			currentRecordingSourceFilePath = null;
			// Return both blob and recordingId so they can be used together
			return Ok({ blob, recordingId, sourceFilePath });
		},
		onSettled: invalidateRecorderState,
	}),

	cancelRecording: defineMutation({
		mutationKey: recorderKeys.cancelRecording,
		mutationFn: async ({ toastId }: { toastId: string }) => {
			const { data: cancelResult, error: cancelRecordingError } =
				await recorderService().cancelRecording({
					sendStatus: (options) => notify.loading({ id: toastId, ...options }),
				});

			// Reset recording ID when canceling
			currentRecordingId = null;
			currentRecordingSourceFilePath = null;

			if (cancelRecordingError) {
				return WhisperingErr({
					title: '❌ Failed to cancel recording',
					serviceError: cancelRecordingError,
				});
			}

			return Ok(cancelResult);
		},
		onSettled: invalidateRecorderState,
	}),
};

/**
 * Get the appropriate recorder service based on settings and environment
 */
export function recorderService() {
	return recorderServiceForMethod(getEffectiveRecordingMethod());
}

function recorderServiceForMethod(method: RecordingMethod) {
	// In browser, always use navigator recorder
	if (!window.__TAURI_INTERNALS__ || method === 'navigator') {
		return services.navigatorRecorder;
	}

	const recorderMap = {
		ffmpeg: desktopServices.ffmpegRecorder,
		cpal: desktopServices.cpalRecorder,
	};
	return recorderMap[method];
}

async function recoverDesktopCpalRecordingId() {
	if (!window.__TAURI_INTERNALS__) {
		return { recordingId: null, lookupError: null };
	}
	if (deviceConfig.get('recording.method') !== 'cpal') {
		return { recordingId: null, lookupError: null };
	}

	try {
		return {
			recordingId: await tauriInvoke<string | null>('get_current_recording_id'),
			lookupError: null,
		};
	} catch (error) {
		return {
			recordingId: null,
			lookupError:
				error instanceof Error ? error.message : 'Unknown recording ID lookup error.',
		};
	}
}

function isDesktopCpalContext() {
	return (
		Boolean(window.__TAURI_INTERNALS__) &&
		deviceConfig.get('recording.method') === 'cpal'
	);
}
