import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const onScaleChangedMock = mock<any>(async () => () => undefined);
const onFocusChangedMock = mock<any>(async () => () => undefined);
const scaleFactorMock = mock<any>(async () => 1);
const innerSizeMock = mock<any>(async () => ({ width: 800, height: 600 }));
const setSizeMock = mock<any>(async () => undefined);

type FocusChangedHandler = (event: { payload: boolean }) => void;
type ScaleChangedHandler = (event: {
	payload: { scaleFactor: number; size: { width: number; height: number } };
}) => void;

type DocumentListener = () => void;

function createDocumentMock(visibilityState: DocumentVisibilityState = 'visible') {
	const listeners = new Map<string, Set<DocumentListener>>();

	return {
		get visibilityState() {
			return visibilityState;
		},
		setVisibilityState(next: DocumentVisibilityState) {
			visibilityState = next;
		},
		dispatch(type: string) {
			for (const listener of listeners.get(type) ?? []) {
				listener();
			}
		},
		addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
			const set = listeners.get(type) ?? new Set<DocumentListener>();
			const wrapped =
				typeof listener === 'function'
					? (listener as DocumentListener)
					: () => listener.handleEvent(new Event(type));
			set.add(wrapped);
			listeners.set(type, set);
		},
		removeEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject,
		) {
			const set = listeners.get(type);
			if (!set) return;
			for (const entry of set) {
				if (entry === listener) {
					set.delete(entry);
				}
			}
		},
		listenerCount(type: string) {
			return listeners.get(type)?.size ?? 0;
		},
	};
}

function createFrameScheduler() {
	const callbacks: Array<() => void> = [];

	return {
		requestFrame(callback: FrameRequestCallback) {
			callbacks.push(() => callback(0));
			return callbacks.length;
		},
		cancelFrame(id: number) {
			callbacks[id - 1] = () => undefined;
		},
		async flushAll() {
			const queued = callbacks.splice(0, callbacks.length);
			for (const callback of queued) {
				await callback();
			}
		},
		get queuedCount() {
			return callbacks.length;
		},
	};
}

async function loadModule() {
	return await import('./register-window-scale-recovery');
}

beforeEach(() => {
	mock.restore();
	onScaleChangedMock.mockReset();
	onFocusChangedMock.mockReset();
	scaleFactorMock.mockReset();
	innerSizeMock.mockReset();
	setSizeMock.mockReset();

	onScaleChangedMock.mockResolvedValue(() => undefined);
	onFocusChangedMock.mockResolvedValue(() => undefined);
	scaleFactorMock.mockResolvedValue(1);
	innerSizeMock.mockResolvedValue({ width: 800, height: 600 });
	setSizeMock.mockResolvedValue(undefined);
});

afterEach(() => {
	mock.restore();
});

describe('registerWindowScaleRecovery', () => {
	test('does nothing outside tauri', async () => {
		const documentMock = createDocumentMock();
		const frameScheduler = createFrameScheduler();
		const currentWindow = {
			onScaleChanged: onScaleChangedMock,
			onFocusChanged: onFocusChangedMock,
			scaleFactor: scaleFactorMock,
			innerSize: innerSizeMock,
			setSize: setSizeMock,
		};

		const { registerWindowScaleRecovery } = await loadModule();
		const cleanup = await registerWindowScaleRecovery({
			isTauri: false,
			currentWindow,
			documentRef: documentMock as never,
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			getDevicePixelRatio: () => 1,
		});

		await frameScheduler.flushAll();
		cleanup();

		expect(onScaleChangedMock).not.toHaveBeenCalled();
		expect(onFocusChangedMock).not.toHaveBeenCalled();
		expect(setSizeMock).not.toHaveBeenCalled();
	});

	test('replays the current window size when wake events reveal a stale dpi scale', async () => {
		const documentMock = createDocumentMock('hidden');
		const frameScheduler = createFrameScheduler();
		let focusHandler: FocusChangedHandler | undefined;
		let scaleHandler: ScaleChangedHandler | undefined;

		onFocusChangedMock.mockImplementation(async (handler: FocusChangedHandler) => {
			focusHandler = handler;
			return () => undefined;
		});
		onScaleChangedMock.mockImplementation(async (handler: ScaleChangedHandler) => {
			scaleHandler = handler;
			return () => undefined;
		});
		scaleFactorMock.mockResolvedValue(1.25);

		const { registerWindowScaleRecovery } = await loadModule();
		await registerWindowScaleRecovery({
			isTauri: true,
			currentWindow: {
				onScaleChanged: onScaleChangedMock,
				onFocusChanged: onFocusChangedMock,
				scaleFactor: scaleFactorMock,
				innerSize: innerSizeMock,
				setSize: setSizeMock,
			},
			documentRef: documentMock as never,
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			getDevicePixelRatio: () => 1,
		});

		documentMock.setVisibilityState('visible');
		documentMock.dispatch('visibilitychange');
		focusHandler?.({ payload: true });
		scaleHandler?.({
			payload: { scaleFactor: 1.25, size: { width: 800, height: 600 } },
		});

		expect(frameScheduler.queuedCount).toBe(1);

		await frameScheduler.flushAll();
		await Promise.resolve();
		await Promise.resolve();

		expect(setSizeMock).toHaveBeenCalledTimes(1);
		expect(setSizeMock.mock.calls[0]?.[0]).toMatchObject({
			width: 800,
			height: 600,
		});
	});

	test('does not nudge the window when dpi scale is already correct', async () => {
		const documentMock = createDocumentMock();
		const frameScheduler = createFrameScheduler();
		let focusHandler: FocusChangedHandler | undefined;

		onFocusChangedMock.mockImplementation(async (handler: FocusChangedHandler) => {
			focusHandler = handler;
			return () => undefined;
		});
		scaleFactorMock.mockResolvedValue(1.25);

		const { registerWindowScaleRecovery } = await loadModule();
		await registerWindowScaleRecovery({
			isTauri: true,
			currentWindow: {
				onScaleChanged: onScaleChangedMock,
				onFocusChanged: onFocusChangedMock,
				scaleFactor: scaleFactorMock,
				innerSize: innerSizeMock,
				setSize: setSizeMock,
			},
			documentRef: documentMock as never,
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			getDevicePixelRatio: () => 1.25,
		});

		focusHandler?.({ payload: true });
		await frameScheduler.flushAll();

		expect(setSizeMock).not.toHaveBeenCalled();
	});
});
