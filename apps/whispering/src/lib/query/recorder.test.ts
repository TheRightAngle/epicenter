import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import { createQueryFactories } from 'wellcrafted/query';
import { asDeviceIdentifier } from '../services/types';

const invokeMock = mock<any>(async () => null);
const startRecordingMock = mock<any>(async () => ({
	data: undefined,
	error: undefined,
}));
const stopRecordingMock = mock<any>(async () => ({
	data: new Blob(['audio']),
	error: undefined,
}));
const cpalEnumerateDevicesMock = mock<any>(async () => ({
	data: [],
	error: undefined,
}));
const ffmpegEnumerateDevicesMock = mock<any>(async () => ({
	data: [],
	error: undefined,
}));
const navigatorEnumerateDevicesMock = mock<any>(async () => ({
	data: [],
	error: undefined,
}));
const getRecorderStateMock = mock<any>(async () => ({ data: 'IDLE', error: undefined }));
const notifyLoadingMock = mock<any>(() => undefined);
const recordingsPathMock = mock<any>(async () => '/tmp/recordings');

async function loadRecorderModule() {
	return await import('./recorder');
}

beforeEach(() => {
	mock.restore();
	invokeMock.mockReset();
	startRecordingMock.mockReset();
	stopRecordingMock.mockReset();
	cpalEnumerateDevicesMock.mockReset();
	ffmpegEnumerateDevicesMock.mockReset();
	navigatorEnumerateDevicesMock.mockReset();
	getRecorderStateMock.mockReset();
	notifyLoadingMock.mockReset();
	recordingsPathMock.mockReset();

	startRecordingMock.mockResolvedValue({
		data: undefined,
		error: undefined,
	});
	stopRecordingMock.mockResolvedValue({
		data: new Blob(['audio']),
		error: undefined,
	});
	cpalEnumerateDevicesMock.mockResolvedValue({ data: [], error: undefined });
	ffmpegEnumerateDevicesMock.mockResolvedValue({ data: [], error: undefined });
	navigatorEnumerateDevicesMock.mockResolvedValue({ data: [], error: undefined });
	getRecorderStateMock.mockResolvedValue({ data: 'IDLE', error: undefined });
	recordingsPathMock.mockResolvedValue('/tmp/recordings');
	invokeMock.mockResolvedValue(null);

	const queryClient = new QueryClient();
	const { defineMutation, defineQuery } = createQueryFactories(queryClient);

	mock.module('@tauri-apps/api/core', () => ({
		invoke: invokeMock,
	}));

	mock.module('$lib/services', () => ({
		desktopServices: {
			cpalRecorder: {
				enumerateDevices: cpalEnumerateDevicesMock,
				getRecorderState: getRecorderStateMock,
				startRecording: startRecordingMock,
				stopRecording: stopRecordingMock,
				cancelRecording: mock(async () => ({
					data: { status: 'cancelled' },
					error: undefined,
				})),
			},
			ffmpegRecorder: {
				enumerateDevices: ffmpegEnumerateDevicesMock,
				getRecorderState: getRecorderStateMock,
				startRecording: startRecordingMock,
				stopRecording: stopRecordingMock,
				cancelRecording: mock(async () => ({
					data: { status: 'cancelled' },
					error: undefined,
				})),
			},
		},
		services: {
			navigatorRecorder: {
				enumerateDevices: navigatorEnumerateDevicesMock,
				getRecorderState: getRecorderStateMock,
				startRecording: startRecordingMock,
				stopRecording: stopRecordingMock,
				cancelRecording: mock(async () => ({
					data: { status: 'cancelled' },
					error: undefined,
				})),
			},
		},
	}));

	mock.module('$lib/state/settings.svelte', () => ({
		settings: {
			value: {
				'recording.method': 'cpal',
				'recording.cpal.outputFolder': '/tmp/out',
				'recording.cpal.deviceId': null,
				'recording.cpal.sampleRate': '16000',
				'recording.cpal.experimentalBufferedCapture': false,
				'recording.ffmpeg.deviceId': null,
				'recording.ffmpeg.globalOptions': '',
				'recording.ffmpeg.inputOptions': '',
				'recording.ffmpeg.outputOptions': '',
				'recording.navigator.deviceId': null,
				'recording.navigator.bitrateKbps': '96',
			},
		},
	}));

	mock.module('$lib/constants/paths', () => ({
		PATHS: {
			DB: {
				RECORDINGS: recordingsPathMock,
			},
		},
	}));

	mock.module('$lib/services/desktop/recorder/ffmpeg', () => ({
		getFileExtensionFromFfmpegOptions: () => 'wav',
	}));

	mock.module('$lib/query/client', () => ({
		queryClient,
		defineMutation,
		defineQuery,
	}));

	mock.module('$lib/result', () => ({
		WhisperingErr: ({
			title,
			description,
			serviceError,
		}: {
			title: string;
			description?: string;
			serviceError?: { message?: string };
		}) => ({
			data: undefined,
			error: {
				name: 'WhisperingError',
				severity: 'error',
				title,
				description: description ?? serviceError?.message ?? '',
			},
		}),
	}));

	mock.module('./notify', () => ({
		notify: {
			loading: notifyLoadingMock,
		},
	}));

	Object.assign(globalThis, {
		window: {
		__TAURI_INTERNALS__: {},
		} as Window & { __TAURI_INTERNALS__?: unknown },
	});
});

afterEach(() => {
	mock.restore();
});

describe('recorder.startRecording', () => {
	test('clears stale currentRecordingId when start fails', async () => {
		startRecordingMock.mockResolvedValue({
			data: undefined,
			error: {
				name: 'RecorderError',
				message: 'start failed',
			} as never,
		});

		const { recorder } = await loadRecorderModule();
		const startResult = await recorder.startRecording({ toastId: 'toast-start' });
		const stopResult = await recorder.stopRecording({ toastId: 'toast-stop' });

		expect(startResult.error?.name).toBe('WhisperingError');
		expect(stopResult.error?.name).toBe('WhisperingError');
		expect(stopResult.error?.title).toBe('❌ Missing recording ID');
		expect(stopRecordingMock).not.toHaveBeenCalled();
	});

	test('clears stale currentRecordingId when start throws', async () => {
		startRecordingMock.mockRejectedValue(new Error('start threw'));

		const { recorder } = await loadRecorderModule();
		const startResult = await recorder.startRecording({ toastId: 'toast-start' });
		const stopResult = await recorder.stopRecording({ toastId: 'toast-stop' });

		expect(startResult.error?.name).toBe('WhisperingError');
		expect(startResult.error?.title).toBe('❌ Failed to start recording');
		expect(startResult.error?.description).toBe('start threw');
		expect(stopResult.error?.name).toBe('WhisperingError');
		expect(stopResult.error?.title).toBe('❌ Missing recording ID');
		expect(stopRecordingMock).not.toHaveBeenCalled();
	});
});

describe('recorder.enumerateDevices', () => {
	test('uses method-scoped query keys and query functions', async () => {
		const settingsModule = await import('$lib/state/settings.svelte');
		const { recorder } = await loadRecorderModule();

		settingsModule.settings.value['recording.method'] = 'ffmpeg';
		const ffmpegOptions = recorder.enumerateDevices.options;

		settingsModule.settings.value['recording.method'] = 'cpal';
		const cpalOptions = recorder.enumerateDevices.options;

		expect(ffmpegOptions.queryKey).toEqual(['recorder', 'devices', 'ffmpeg']);
		expect(cpalOptions.queryKey).toEqual(['recorder', 'devices', 'cpal']);

		await (ffmpegOptions.queryFn as () => Promise<unknown>)();
		await (cpalOptions.queryFn as () => Promise<unknown>)();
		expect(ffmpegEnumerateDevicesMock).toHaveBeenCalledTimes(1);
		expect(cpalEnumerateDevicesMock).toHaveBeenCalledTimes(1);
	});

	test('skips navigator label enrichment when desktop labels are already unique', async () => {
		cpalEnumerateDevicesMock.mockResolvedValue({
			data: [
				{
					id: asDeviceIdentifier('wasapi:realtek'),
					label: 'Microphone (Realtek(R) Audio)',
				},
				{
					id: asDeviceIdentifier('wasapi:webcam'),
					label: 'Microphone (1080P Pro Stream)',
				},
			],
			error: undefined,
		});

		const { recorder } = await loadRecorderModule();
		const queryFn = recorder.enumerateDevices.options.queryFn as () => Promise<
			unknown
		>;
		const result = await queryFn();

		expect(result).toEqual([
			{
				id: asDeviceIdentifier('wasapi:realtek'),
				label: 'Microphone (Realtek(R) Audio)',
			},
			{
				id: asDeviceIdentifier('wasapi:webcam'),
				label: 'Microphone (1080P Pro Stream)',
			},
		]);
		expect(navigatorEnumerateDevicesMock).not.toHaveBeenCalled();
	});

	test('disambiguates duplicate desktop labels using richer navigator labels', async () => {
		Object.assign(globalThis, {
			window: {
				__TAURI_INTERNALS__: {},
			} as Window & { __TAURI_INTERNALS__?: unknown },
		});

		cpalEnumerateDevicesMock.mockResolvedValue({
			data: [
				{ id: asDeviceIdentifier('cpal-a'), label: 'Microphone' },
				{ id: asDeviceIdentifier('cpal-b'), label: 'Microphone' },
			],
			error: undefined,
		});
		navigatorEnumerateDevicesMock.mockResolvedValue({
			data: [
				{
					id: asDeviceIdentifier('nav-a'),
					label: 'Microphone (Laptop Array)',
				},
				{
					id: asDeviceIdentifier('nav-b'),
					label: 'Microphone (Webcam Mic)',
				},
			],
			error: undefined,
		});

		const { recorder } = await loadRecorderModule();
		const queryFn = recorder.enumerateDevices.options.queryFn as () => Promise<
			unknown
		>;
		const result = await queryFn();

		expect(result).toEqual([
			{ id: asDeviceIdentifier('cpal-a'), label: 'Microphone (Laptop Array)' },
			{ id: asDeviceIdentifier('cpal-b'), label: 'Microphone (Webcam Mic)' },
		]);
	});
});

describe('recorder.stopRecording', () => {
	test('recovers the active CPAL recording id from backend state before stopping', async () => {
		invokeMock.mockResolvedValue('rec-backend');

		const { recorder } = await loadRecorderModule();
		const stopResult = await recorder.stopRecording({ toastId: 'toast-stop' });

		expect(stopResult.data?.recordingId).toBe('rec-backend');
		expect(stopResult.data?.blob).toBeInstanceOf(Blob);
		expect(stopRecordingMock).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith('get_current_recording_id');
	});

	test('treats recovered CPAL ids as terminal after post-stop failures', async () => {
		invokeMock
			.mockResolvedValueOnce('rec-backend')
			.mockResolvedValueOnce(null);
		stopRecordingMock
			.mockResolvedValueOnce({
				data: undefined,
				error: {
					name: 'RecorderError',
					message: 'read failed',
				},
			})
			.mockResolvedValueOnce({
				data: new Blob(['audio']),
				error: undefined,
			});

		const { recorder } = await loadRecorderModule();
		const firstStopResult = await recorder.stopRecording({ toastId: 'toast-stop-1' });
		const secondStopResult = await recorder.stopRecording({ toastId: 'toast-stop-2' });

		expect(firstStopResult.error?.title).toBe('❌ Failed to stop recording');
		expect(secondStopResult.error?.title).toBe('❌ Missing recording ID');
		expect(stopRecordingMock).toHaveBeenCalledTimes(1);
		expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	test('does not call backend stop when currentRecordingId is missing and cannot be recovered', async () => {
		const { recorder } = await loadRecorderModule();
		const stopResult = await recorder.stopRecording({ toastId: 'toast-stop' });

		expect(stopResult.error?.name).toBe('WhisperingError');
		expect(stopResult.error?.title).toBe('❌ Missing recording ID');
		expect(stopRecordingMock).not.toHaveBeenCalled();
		expect(invokeMock).toHaveBeenCalledWith('get_current_recording_id');
	});

	test('surfaces backend recording id lookup failures distinctly', async () => {
		invokeMock.mockRejectedValue(new Error('lookup boom'));

		const { recorder } = await loadRecorderModule();
		const stopResult = await recorder.stopRecording({ toastId: 'toast-stop' });

		expect(stopResult.error?.name).toBe('WhisperingError');
		expect(stopResult.error?.title).toBe('❌ Failed to recover recording ID');
		expect(stopResult.error?.description).toBe('lookup boom');
		expect(stopRecordingMock).not.toHaveBeenCalled();
	});
});
