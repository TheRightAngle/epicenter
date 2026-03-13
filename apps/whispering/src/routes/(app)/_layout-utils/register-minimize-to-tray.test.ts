import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const onResizedMock = mock<any>(async () => () => undefined);
const isMinimizedMock = mock<any>(async () => false);
const hideMock = mock<any>(async () => undefined);

type ResizeHandler = (event: { payload: { width: number; height: number } }) => void;

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
	};
}

async function loadModule() {
	return await import('./register-minimize-to-tray').catch(() => ({
		registerMinimizeToTray: undefined,
	}));
}

function expectRegisterMinimizeToTray(
	value: unknown,
): asserts value is (options: {
	isTauri?: boolean;
	currentWindow?: {
		onResized: typeof onResizedMock;
		isMinimized: typeof isMinimizedMock;
		hide: typeof hideMock;
	};
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
	isEnabled?: () => boolean;
}) => Promise<() => void> {
	expect(value).toBeFunction();
}

beforeEach(() => {
	mock.restore();
	onResizedMock.mockReset();
	isMinimizedMock.mockReset();
	hideMock.mockReset();

	onResizedMock.mockResolvedValue(() => undefined);
	isMinimizedMock.mockResolvedValue(false);
	hideMock.mockResolvedValue(undefined);
});

afterEach(() => {
	mock.restore();
});

describe('registerMinimizeToTray', () => {
	test('does nothing outside tauri', async () => {
		const frameScheduler = createFrameScheduler();
		const currentWindow = {
			onResized: onResizedMock,
			isMinimized: isMinimizedMock,
			hide: hideMock,
		};

		const module = await loadModule();
		expectRegisterMinimizeToTray(module.registerMinimizeToTray);

		const cleanup = await module.registerMinimizeToTray({
			isTauri: false,
			currentWindow,
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			isEnabled: () => true,
		});

		await frameScheduler.flushAll();
		cleanup();

		expect(onResizedMock).not.toHaveBeenCalled();
		expect(isMinimizedMock).not.toHaveBeenCalled();
		expect(hideMock).not.toHaveBeenCalled();
	});

	test('hides the window when minimize to tray is enabled and the window becomes minimized', async () => {
		const frameScheduler = createFrameScheduler();
		let resizeHandler: ResizeHandler | undefined;

		onResizedMock.mockImplementation(async (handler: ResizeHandler) => {
			resizeHandler = handler;
			return () => undefined;
		});
		isMinimizedMock.mockResolvedValue(true);

		const module = await loadModule();
		expectRegisterMinimizeToTray(module.registerMinimizeToTray);

		await module.registerMinimizeToTray({
			isTauri: true,
			currentWindow: {
				onResized: onResizedMock,
				isMinimized: isMinimizedMock,
				hide: hideMock,
			},
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			isEnabled: () => true,
		});

		resizeHandler?.({ payload: { width: 800, height: 600 } });
		await frameScheduler.flushAll();
		await Promise.resolve();
		await Promise.resolve();

		expect(hideMock).toHaveBeenCalledTimes(1);
	});

	test('does not hide the window when minimize to tray is disabled', async () => {
		const frameScheduler = createFrameScheduler();
		let resizeHandler: ResizeHandler | undefined;

		onResizedMock.mockImplementation(async (handler: ResizeHandler) => {
			resizeHandler = handler;
			return () => undefined;
		});
		isMinimizedMock.mockResolvedValue(true);

		const module = await loadModule();
		expectRegisterMinimizeToTray(module.registerMinimizeToTray);

		await module.registerMinimizeToTray({
			isTauri: true,
			currentWindow: {
				onResized: onResizedMock,
				isMinimized: isMinimizedMock,
				hide: hideMock,
			},
			requestFrame: frameScheduler.requestFrame,
			cancelFrame: frameScheduler.cancelFrame,
			isEnabled: () => false,
		});

		resizeHandler?.({ payload: { width: 800, height: 600 } });
		await frameScheduler.flushAll();
		await Promise.resolve();

		expect(hideMock).not.toHaveBeenCalled();
	});
});
