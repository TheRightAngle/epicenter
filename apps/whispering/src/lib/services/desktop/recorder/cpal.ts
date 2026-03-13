import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';
import type {
	CancelRecordingResult,
	WhisperingRecordingState,
} from '$lib/constants/audio';
import { FsServiceLive } from '$lib/services/desktop/fs';
import {
	type CpalRecordingParams,
	RecorderError,
	type RecorderService,
} from '$lib/services/recorder/types';
import {
	asDeviceIdentifier,
	type Device,
	type DeviceAcquisitionOutcome,
} from '$lib/services/types';

/**
 * Audio recording data returned from the Rust method
 */
type AudioRecording = {
	sampleRate: number;
	channels: number;
	durationSeconds: number;
	filePath?: string;
};

const closeRecordingSession = async ({
	sendStatus,
}: {
	sendStatus: (args: { title: string; description: string }) => void;
}): Promise<Result<void, RecorderError>> => {
	sendStatus({
		title: '🔄 Closing Session',
		description: 'Cleaning up recording resources...',
	});
	const { error: closeError } = await invoke<void>('close_recording_session');
	if (closeError) {
		console.error('Failed to close recording session:', closeError);
		return Err(closeError);
	}
	return Ok(undefined);
};

const discardRecordingSession = async ({
	sendStatus,
}: {
	sendStatus: (args: { title: string; description: string }) => void;
}): Promise<Result<void, RecorderError>> => {
	sendStatus({
		title: '🛑 Discarding Recording',
		description: 'Cleaning up the partial recording...',
	});

	const { error: cancelError } = await invoke<void>('cancel_recording');
	if (cancelError) {
		console.error('Failed to cancel recording session:', cancelError);
		const { error: closeError } = await closeRecordingSession({ sendStatus });
		if (closeError) {
			return RecorderError.StopFailed({
				cause: formatCleanupAwareError({
					primaryError: cancelError,
					cleanupError: closeError,
					cleanupAction: 'closing the recording session after cancel_recording failed',
				}),
			});
		}
		return Err(cancelError);
	}
	return Ok(undefined);
};

const formatCleanupAwareError = ({
	primaryError,
	cleanupError,
	cleanupAction,
}: {
	primaryError: { message?: string } | unknown;
	cleanupError: { message?: string } | unknown;
	cleanupAction: string;
}) =>
	new Error(
		`${extractErrorMessage(primaryError)} Cleanup failed while ${cleanupAction}: ${extractErrorMessage(cleanupError)}`,
	);

/**
 * Enumerates available recording devices from the system.
 */
const enumerateDevices = async (): Promise<Result<Device[], RecorderError>> => {
	const { data: deviceNames, error: enumerateRecordingDevicesError } =
		await invoke<string[]>('enumerate_recording_devices');
	if (enumerateRecordingDevicesError) {
		return RecorderError.EnumerateDevices({
			cause: enumerateRecordingDevicesError,
		});
	}
	// On desktop, device names serve as both ID and label
	return Ok(
		deviceNames.map((name) => ({
			id: asDeviceIdentifier(name),
			label: name,
		})),
	);
};

/**
 * CPAL recorder service that uses the Rust CPAL method.
 * This service handles device enumeration, recording start/stop operations, and file management
 * for desktop audio recording using the CPAL library.
 */
export const CpalRecorderServiceLive: RecorderService = {
	/**
	 * Gets the current state of the recorder.
	 */
	getRecorderState: async (): Promise<
		Result<WhisperingRecordingState, RecorderError>
	> => {
		const { data: recordingId, error: getRecorderStateError } = await invoke<
			string | null
		>('get_current_recording_id');
		if (getRecorderStateError)
			return RecorderError.GetStateFailed({
				cause: getRecorderStateError,
			});

		return Ok(recordingId ? 'RECORDING' : 'IDLE');
	},

	enumerateDevices,

	/**
	 * Starts a recording session with the specified parameters.
	 * Handles device selection, fallback logic, and recording initialization.
	 *
	 * @param params - Recording parameters including device ID, recording ID, output folder, and sample rate
	 * @param callbacks - Callback functions for status updates
	 */
	startRecording: async (
		{
			selectedDeviceId,
			recordingId,
			outputFolder,
			sampleRate,
		}: CpalRecordingParams,
		{ sendStatus },
	): Promise<Result<DeviceAcquisitionOutcome, RecorderError>> => {
		const { data: devices, error: enumerateError } = await enumerateDevices();
		if (enumerateError) return Err(enumerateError);

		/**
		 * Acquires a recording device, either the selected one or a fallback.
		 */
		const acquireDevice = (): Result<
			DeviceAcquisitionOutcome,
			RecorderError
		> => {
			const deviceIds = devices.map((d) => d.id);
			const fallbackDeviceId = deviceIds.at(0);
			if (!fallbackDeviceId) {
				return RecorderError.NoDevice({
					message: selectedDeviceId
						? "We couldn't find the selected microphone. Make sure it's connected and try again!"
						: "We couldn't find any microphones. Make sure they're connected and try again!",
				});
			}

			if (!selectedDeviceId) {
				sendStatus({
					title: '🔍 No Device Selected',
					description: "We'll use an available microphone automatically...",
				});
				return Ok({
					outcome: 'fallback',
					reason: 'no-device-selected',
					deviceId: fallbackDeviceId,
				});
			}

			// Check if the selected device exists in the devices array
			const deviceExists = deviceIds.includes(selectedDeviceId);

			if (deviceExists)
				return Ok({ outcome: 'success', deviceId: selectedDeviceId });

			sendStatus({
				title: '⚠️ Finding a New Microphone',
				description:
					"That microphone isn't available. Let's try finding another one...",
			});

			return Ok({
				outcome: 'fallback',
				reason: 'preferred-device-unavailable',
				deviceId: fallbackDeviceId,
			});
		};

		const { data: deviceOutcome, error: acquireDeviceError } = acquireDevice();
		if (acquireDeviceError) return Err(acquireDeviceError);

		// Use the device from the outcome
		const deviceIdentifier = deviceOutcome.deviceId;

		// Now initialize recording with the chosen device
		sendStatus({
			title: '🎤 Setting Up',
			description:
				'Initializing your recording session and checking microphone access...',
		});

		// Convert sample rate string to number if provided
		const sampleRateNum = sampleRate
			? Number.parseInt(sampleRate, 10)
			: undefined;

		const { error: initRecordingSessionError } = await invoke(
			'init_recording_session',
			{
				deviceIdentifier,
				recordingId,
				outputFolder,
				sampleRate: sampleRateNum,
			},
		);
		if (initRecordingSessionError) {
			const { error: discardError } = await discardRecordingSession({
				sendStatus,
			});
				return RecorderError.InitFailed({
					cause: discardError
						? formatCleanupAwareError({
								primaryError: initRecordingSessionError,
								cleanupError: discardError,
								cleanupAction: 'discarding the partial recording',
							})
						: initRecordingSessionError,
				});
		}

		sendStatus({
			title: '🎙️ Starting Recording',
			description:
				'Recording session initialized, now starting to capture audio...',
		});
		const { error: startRecordingError } = await invoke<void>('start_recording');
		if (startRecordingError) {
			const { error: discardError } = await discardRecordingSession({
				sendStatus,
			});
				return RecorderError.StartFailed({
					cause: discardError
						? formatCleanupAwareError({
								primaryError: startRecordingError,
								cleanupError: discardError,
								cleanupAction: 'discarding the partial recording',
							})
						: startRecordingError,
				});
			}

		return Ok(deviceOutcome);
	},

	/**
	 * Stops the current recording session and returns the recorded audio as a Blob.
	 * Handles file reading, session cleanup, and resource management.
	 *
	 * @param callbacks - Callback functions for status updates
	 */
	stopRecording: async ({
		sendStatus,
	}): Promise<Result<Blob, RecorderError>> => {
		const { data: audioRecording, error: stopRecordingError } =
			await invoke<AudioRecording>('stop_recording');

		let primaryResult: Result<Blob, RecorderError>;
		let consumedBackendStop = !stopRecordingError;

		if (stopRecordingError) {
			primaryResult = RecorderError.StopFailed({ cause: stopRecordingError });
		} else {
			const { filePath } = audioRecording;
			if (!filePath) {
				primaryResult = RecorderError.NoFilePath();
			} else {
				sendStatus({
					title: '📁 Reading Recording',
					description: 'Loading your recording from disk...',
				});

				const { data: blob, error: readRecordingFileError } =
					await FsServiceLive.pathToBlob(filePath);
				primaryResult = readRecordingFileError
					? RecorderError.ReadFileFailed({
							cause: readRecordingFileError,
						})
					: Ok(blob);
			}
		}

		const { error: closeError } = await closeRecordingSession({ sendStatus });
		if (closeError) {
			if (primaryResult.error) {
				return combineStopErrors({
					primaryError: primaryResult.error,
					closeError,
					consumedBackendStop,
				});
			}
			return RecorderError.StopFailed({
				cause: formatCleanupAwareError({
					primaryError: 'Recording stopped successfully.',
					cleanupError: closeError,
					cleanupAction: 'closing the recording session',
				}),
			});
		}

		return primaryResult;
	},

	/**
	 * Cancels the current recording session and cleans up resources.
	 * Deletes any temporary recording files and closes the recording session.
	 *
	 * @param callbacks - Callback functions for status updates
	 */
	cancelRecording: async ({
		sendStatus,
	}): Promise<Result<CancelRecordingResult, RecorderError>> => {
		// Check current state first
		const { data: recordingId, error: getRecordingIdError } = await invoke<
			string | null
		>('get_current_recording_id');
		if (getRecordingIdError) {
			return RecorderError.GetStateFailed({
				cause: getRecordingIdError,
			});
		}

		if (!recordingId) {
			return Ok({ status: 'no-recording' });
		}

		sendStatus({
			title: '🛑 Cancelling',
			description:
				'Safely stopping your recording and cleaning up resources...',
		});

		const { error: discardError } = await discardRecordingSession({ sendStatus });
		if (discardError) {
			return Err(discardError);
		}

		return Ok({ status: 'cancelled' });
	},
};

/**
 * Wrapper function for Tauri invoke calls that handles errors consistently.
 * Converts Tauri invoke calls into Result types for better error handling.
 *
 * @param command - The Tauri command to invoke
 * @param args - Optional arguments to pass to the command
 */
async function invoke<T>(command: string, args?: Record<string, unknown>) {
	return tryAsync({
		try: async () => await tauriInvoke<T>(command, args),
		catch: (error) => RecorderError.InvokeFailed({ command, cause: error }),
	});
}

function combineStopErrors({
	primaryError,
	closeError,
	consumedBackendStop,
}: {
	primaryError: RecorderError;
	closeError: RecorderError;
	consumedBackendStop: boolean;
}) {
	const cleanupAction = consumedBackendStop
		? 'closing the recording session after the backend stop was consumed'
		: 'closing the recording session';

	if (primaryError.message.startsWith('Unable to read recording file:')) {
		return RecorderError.ReadFileFailed({
			cause: formatCleanupAwareError({
				primaryError,
				cleanupError: closeError,
				cleanupAction,
			}),
		});
	}

	return RecorderError.StopFailed({
		cause: formatCleanupAwareError({
			primaryError,
			cleanupError: closeError,
			cleanupAction,
		}),
	});
}

function extractErrorMessage(cause: { message?: string } | unknown) {
	if (cause instanceof Error) return cause.message;
	if (typeof cause === 'object' && cause && 'message' in cause) {
		return String(cause.message);
	}
	if (
		typeof cause === 'object' &&
		cause &&
		'error' in cause &&
		typeof cause.error === 'object' &&
		cause.error &&
		'message' in cause.error
	) {
		return String(cause.error.message);
	}
	return String(cause);
}
