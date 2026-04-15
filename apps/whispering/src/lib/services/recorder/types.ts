import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import type {
	CancelRecordingResult,
	WhisperingRecordingState,
} from '$lib/constants/audio';
import type {
	Device,
	DeviceAcquisitionOutcome,
	DeviceIdentifier,
	UpdateStatusMessageFn,
} from '$lib/services/types';

export const RecorderError = defineErrors({
	EnumerateDevices: ({ cause }: { cause: unknown }) => ({
		message: `Failed to enumerate recording devices: ${extractErrorMessage(cause)}`,
		cause,
	}),
	NoDevice: ({ message }: { message: string }) => ({
		message,
	}),
	AlreadyRecording: () => ({
		message:
			'A recording is already in progress. Please stop the current recording before starting a new one.',
	}),
	NotRecording: ({ message }: { message: string }) => ({
		message,
	}),
	InitFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to initialize the audio recorder: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StartFailed: ({ cause }: { cause: unknown }) => ({
		message: `Unable to start recording: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StopFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to stop recording: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StreamAcquisition: ({ cause }: { cause: unknown }) => ({
		message: `Failed to acquire recording stream: ${extractErrorMessage(cause)}`,
		cause,
	}),
	ReadFileFailed: ({ cause }: { cause: unknown }) => ({
		message: `Unable to read recording file: ${extractErrorMessage(cause)}`,
		cause,
	}),
	NoFilePath: () => ({
		message: 'Recording file path not provided by method.',
	}),
	EmptyRecording: () => ({
		message: 'Recording file is empty.',
	}),
	FileDeleteFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to delete recording file: ${extractErrorMessage(cause)}`,
		cause,
	}),
	GetStateFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to get recorder state: ${extractErrorMessage(cause)}`,
		cause,
	}),
	InvokeFailed: ({ command, cause }: { command: string; cause: unknown }) => ({
		message: `Tauri invoke '${command}' failed: ${extractErrorMessage(cause)}`,
		command,
		cause,
	}),
});
export type RecorderError = InferErrors<typeof RecorderError>;

/**
 * Base parameters shared across all methods
 */
type BaseRecordingParams = {
	selectedDeviceId: DeviceIdentifier | null;
	recordingId: string;
};

/**
 * CPAL (native Rust) recording parameters
 */
export type CpalRecordingParams = BaseRecordingParams & {
	method: 'cpal';
	outputFolder: string;
	sampleRate: string;
	/**
	 * When true, capture audio into an in-memory buffer instead of writing a
	 * WAV file on disk. Useful for short ephemeral recordings where the disk
	 * write is wasted work. Regardless of value, the audio callback is
	 * channel-based and never blocks on a mutex or I/O.
	 */
	bufferedCapture: boolean;
};

/**
 * Navigator (MediaRecorder) recording parameters
 */
export type NavigatorRecordingParams = BaseRecordingParams & {
	method: 'navigator';
	bitrateKbps: string;
};

/**
 * FFmpeg recording parameters
 */
export type FfmpegRecordingParams = BaseRecordingParams & {
	method: 'ffmpeg';
	globalOptions: string;
	inputOptions: string;
	outputOptions: string;
	outputFolder: string;
};

/**
 * Discriminated union for recording parameters based on method
 */
export type StartRecordingParams =
	| CpalRecordingParams
	| NavigatorRecordingParams
	| FfmpegRecordingParams;

/**
 * Recorder service interface shared by all methods
 */
export type RecorderService = {
	/**
	 * Get the current recorder state
	 * Returns 'IDLE' if no recording is active, 'RECORDING' if recording is in progress
	 */
	getRecorderState(): Promise<Result<WhisperingRecordingState, RecorderError>>;

	/**
	 * Enumerate available recording devices with their labels and identifiers
	 */
	enumerateDevices(): Promise<Result<Device[], RecorderError>>;

	/**
	 * Start a new recording session
	 */
	startRecording(
		params: StartRecordingParams,
		callbacks: {
			sendStatus: UpdateStatusMessageFn;
		},
	): Promise<Result<DeviceAcquisitionOutcome, RecorderError>>;

	/**
	 * Stop the current recording and return the audio blob
	 */
	stopRecording(callbacks: {
		sendStatus: UpdateStatusMessageFn;
	}): Promise<Result<Blob, RecorderError>>;

	/**
	 * Cancel the current recording without saving
	 */
	cancelRecording(callbacks: {
		sendStatus: UpdateStatusMessageFn;
	}): Promise<Result<CancelRecordingResult, RecorderError>>;
};
