import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const invokeMock = mock<any>(async () => undefined);
const pathToBlobMock = mock<any>(async () => ({
	data: new Blob(),
	error: undefined,
}));
const removeMock = mock<any>(async () => undefined);
const asRecorderErr = (message: string) => ({
	data: undefined,
	error: {
		name: 'RecorderError',
		message,
	},
});

function commandLog() {
	return invokeMock.mock.calls.map((args) => args[0] as string);
}

async function loadCpalModule() {
	return await import('./cpal');
}

beforeEach(() => {
	mock.restore();
	invokeMock.mockReset();
	pathToBlobMock.mockReset();
	removeMock.mockReset();

	mock.module('@tauri-apps/api/core', () => ({
		invoke: invokeMock,
	}));

	mock.module('$lib/services/desktop/fs', () => ({
		FsServiceLive: {
			pathToBlob: pathToBlobMock,
		},
	}));

	mock.module('@tauri-apps/plugin-fs', () => ({
		remove: removeMock,
	}));

	mock.module('$lib/services/recorder/types', () => ({
		RecorderError: {
			EnumerateDevices: ({ cause }: { cause: unknown }) => ({
				...asRecorderErr(`Failed to enumerate recording devices: ${String(cause)}`),
			}),
			GetStateFailed: ({ cause }: { cause: unknown }) => ({
				...asRecorderErr(`Failed to get recorder state: ${String(cause)}`),
			}),
			NoDevice: ({ message }: { message: string }) => ({
				...asRecorderErr(message),
			}),
			InitFailed: ({ cause }: { cause: unknown }) => ({
				...asRecorderErr(`Failed to initialize the audio recorder: ${String(cause)}`),
			}),
			StartFailed: ({ cause }: { cause: { message: string } }) => ({
				...asRecorderErr(`Unable to start recording: ${cause.message}`),
			}),
			StopFailed: ({ cause }: { cause: { message: string } }) => ({
				...asRecorderErr(`Failed to stop recording: ${cause.message}`),
			}),
			NoFilePath: () => ({
				...asRecorderErr('Recording file path not provided by method.'),
			}),
			ReadFileFailed: ({ cause }: { cause: { message?: string } }) => ({
				...asRecorderErr(
					`Unable to read recording file: ${cause.message ?? String(cause)}`,
				),
			}),
			FileDeleteFailed: ({ cause }: { cause: unknown }) => ({
				...asRecorderErr(`Failed to delete recording file: ${String(cause)}`),
			}),
			InvokeFailed: ({ command, cause }: { command: string; cause: unknown }) => ({
				...asRecorderErr(
					`Tauri invoke '${command}' failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
			}),
		},
	}));

	mock.module('$lib/services/types', () => ({
		asDeviceIdentifier: (value: string) => value,
	}));
});

afterEach(() => {
	mock.restore();
});

describe('CpalRecorderServiceLive', () => {
	test('closes the recording session when start_recording fails after init', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return ['Mic 1'];
				case 'init_recording_session':
					return undefined;
				case 'start_recording':
					throw new Error('start boom');
				case 'stop_recording':
					return {
						sampleRate: 16000,
						channels: 1,
						durationSeconds: 0,
						filePath: '/tmp/rec-1.wav',
					};
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
				}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.startRecording(
			{
				method: 'cpal',
				selectedDeviceId: 'Mic 1' as never,
				recordingId: 'rec-1',
				outputFolder: '/tmp',
				sampleRate: '16000',
			},
			{ sendStatus: () => undefined },
		);

		expect(result.error?.message).toContain('Unable to start recording');
		expect(commandLog()).toEqual([
			'enumerate_recording_devices',
			'init_recording_session',
			'start_recording',
			'stop_recording',
			'close_recording_session',
		]);
		expect(removeMock).toHaveBeenCalledWith('/tmp/rec-1.wav');
	});

	test('closes the session when stopRecording returns no file path', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'stop_recording':
					return {
						sampleRate: 16000,
						channels: 1,
						durationSeconds: 1,
					};
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});

		expect(result.error?.message).toBe('Recording file path not provided by method.');
		expect(commandLog()).toEqual(['stop_recording', 'close_recording_session']);
	});

	test('closes the session when stop_recording itself fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'stop_recording':
					throw new Error('stop boom');
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});

		expect(result.error?.message).toContain('Failed to stop recording');
		expect(commandLog()).toEqual(['stop_recording', 'close_recording_session']);
	});

	test('closes the session when reading the stopped recording file fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'stop_recording':
					return {
						sampleRate: 16000,
						channels: 1,
						durationSeconds: 1,
						filePath: '/tmp/rec.wav',
					};
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});
		pathToBlobMock.mockResolvedValue({
			data: undefined,
			error: new Error('read boom'),
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});

		expect(result.error?.message).toContain('Unable to read recording file');
		expect(commandLog()).toEqual(['stop_recording', 'close_recording_session']);
	});
});
