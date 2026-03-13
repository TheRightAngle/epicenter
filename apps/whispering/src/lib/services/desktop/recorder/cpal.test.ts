import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const invokeMock = mock<any>(async () => undefined);
const pathToBlobMock = mock<any>(async () => ({
	data: new Blob(),
	error: undefined,
}));
const asDeviceIdentifier = (value: string) => value as never;
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
	pathToBlobMock.mockResolvedValue({
		data: new Blob(),
		error: undefined,
	});

	mock.module('@tauri-apps/api/core', () => ({
		invoke: invokeMock,
	}));

	mock.module('$lib/services/desktop/fs', () => ({
		FsServiceLive: {
			pathToBlob: pathToBlobMock,
		},
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
	test('discards the recording session when init_recording_session fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return [{ id: 'wasapi:mic-1', label: 'Microphone (Realtek(R) Audio)' }];
				case 'init_recording_session':
					throw new Error('init boom');
				case 'cancel_recording':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
				}
			});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.startRecording(
			{
				method: 'cpal',
				selectedDeviceId: 'wasapi:mic-1' as never,
				recordingId: 'rec-1',
				outputFolder: '/tmp',
				sampleRate: '16000',
				experimentalBufferedCapture: false,
			},
			{ sendStatus: () => undefined },
		);

		expect(result.error?.message).toContain(
			'Failed to initialize the audio recorder',
		);
		expect(commandLog()).toEqual([
			'enumerate_recording_devices',
			'init_recording_session',
			'cancel_recording',
		]);
	});

	test('surfaces discard cleanup failure when init_recording_session fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return [{ id: 'wasapi:mic-1', label: 'Microphone (Realtek(R) Audio)' }];
				case 'init_recording_session':
					throw new Error('init boom');
				case 'cancel_recording':
					throw new Error('cancel boom');
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
				selectedDeviceId: 'wasapi:mic-1' as never,
				recordingId: 'rec-1',
				outputFolder: '/tmp',
				sampleRate: '16000',
				experimentalBufferedCapture: false,
			},
			{ sendStatus: () => undefined },
		);

		expect(result.error?.message).toContain('init boom');
		expect(result.error?.message).toContain('cancel boom');
		expect(commandLog()).toEqual([
			'enumerate_recording_devices',
			'init_recording_session',
			'cancel_recording',
			'close_recording_session',
		]);
	});

	test('surfaces combined cancel and close cleanup failures when init_recording_session fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return [{ id: 'wasapi:mic-1', label: 'Microphone (Realtek(R) Audio)' }];
				case 'init_recording_session':
					throw new Error('init boom');
				case 'cancel_recording':
					throw new Error('cancel boom');
				case 'close_recording_session':
					throw new Error('close boom');
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.startRecording(
			{
				method: 'cpal',
				selectedDeviceId: 'wasapi:mic-1' as never,
				recordingId: 'rec-1',
				outputFolder: '/tmp',
				sampleRate: '16000',
				experimentalBufferedCapture: false,
			},
			{ sendStatus: () => undefined },
		);

		expect(result.error?.message).toContain('init boom');
		expect(result.error?.message).toContain('cancel boom');
		expect(result.error?.message).toContain('close boom');
		expect(commandLog()).toEqual([
			'enumerate_recording_devices',
			'init_recording_session',
			'cancel_recording',
			'close_recording_session',
		]);
	});

	test('closes the recording session when start_recording fails after init', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return [{ id: 'wasapi:mic-1', label: 'Microphone (Realtek(R) Audio)' }];
				case 'init_recording_session':
					return undefined;
				case 'start_recording':
					throw new Error('start boom');
				case 'cancel_recording':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.startRecording(
			{
				method: 'cpal',
				selectedDeviceId: 'wasapi:mic-1' as never,
				recordingId: 'rec-1',
				outputFolder: '/tmp',
				sampleRate: '16000',
				experimentalBufferedCapture: false,
			},
			{ sendStatus: () => undefined },
		);

		expect(result.error?.message).toContain('Unable to start recording');
		expect(commandLog()).toEqual([
			'enumerate_recording_devices',
			'init_recording_session',
			'start_recording',
			'cancel_recording',
		]);
	});

	test('returns stable desktop device ids with richer Windows labels', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'enumerate_recording_devices':
					return [
						{ id: 'wasapi:mic-realtek', label: 'Microphone (Realtek(R) Audio)' },
						{ id: 'wasapi:mic-webcam', label: 'Microphone (1080P Pro Stream)' },
					];
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.enumerateDevices();

		expect(result.data).toEqual([
			{
				id: asDeviceIdentifier('wasapi:mic-realtek'),
				label: 'Microphone (Realtek(R) Audio)',
			},
			{
				id: asDeviceIdentifier('wasapi:mic-webcam'),
				label: 'Microphone (1080P Pro Stream)',
			},
		]);
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

	test('returns an in-memory wav blob when stopRecording returns audio data', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'stop_recording':
					return {
						sampleRate: 16000,
						channels: 1,
						durationSeconds: 1,
						audioData: [0, 0.25, -0.25, 0.5],
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

		expect(result.data).toBeInstanceOf(Blob);
		expect(result.data?.type).toBe('audio/wav');
		expect(result.data?.size).toBeGreaterThan(44);
		expect(pathToBlobMock).not.toHaveBeenCalled();
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

	test('surfaces close_recording_session failure after a successful stop', async () => {
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
					throw new Error('close boom');
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});

		expect(result.error?.message).toContain('Failed to stop recording');
		expect(result.error?.message).toContain('close boom');
		expect(commandLog()).toEqual(['stop_recording', 'close_recording_session']);
	});

	test('treats post-stop read failures as terminal once the backend session is closed', async () => {
		let stopCalls = 0;
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'stop_recording':
					stopCalls += 1;
					if (stopCalls === 1) {
						return {
							sampleRate: 16000,
							channels: 1,
							durationSeconds: 1,
							filePath: '/tmp/rec.wav',
						};
					}
					throw new Error('session already closed');
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});
		pathToBlobMock.mockResolvedValueOnce({
			data: undefined,
			error: new Error('read boom'),
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const firstResult = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});
		const secondResult = await CpalRecorderServiceLive.stopRecording({
			sendStatus: () => undefined,
		});

		expect(firstResult.error?.message).toContain('Unable to read recording file');
		expect(secondResult.error?.message).toContain('Failed to stop recording');
		expect(secondResult.error?.message).toContain('session already closed');
		expect(commandLog()).toEqual([
			'stop_recording',
			'close_recording_session',
			'stop_recording',
			'close_recording_session',
		]);
	});

	test('returns an error when cancel cleanup fails', async () => {
		invokeMock.mockImplementation(async (command: string) => {
			switch (command) {
				case 'get_current_recording_id':
					return 'rec-1';
				case 'cancel_recording':
					throw new Error('cancel boom');
				case 'close_recording_session':
					return undefined;
				default:
					throw new Error(`Unexpected command ${command}`);
			}
		});

		const { CpalRecorderServiceLive } = await loadCpalModule();
		const result = await CpalRecorderServiceLive.cancelRecording({
			sendStatus: () => undefined,
		});

		expect(result.error?.message).toContain('cancel boom');
		expect(commandLog()).toEqual([
			'get_current_recording_id',
			'cancel_recording',
			'close_recording_session',
		]);
	});
});
