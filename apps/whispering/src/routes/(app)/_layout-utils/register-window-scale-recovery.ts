import {
	getCurrentWindow,
	PhysicalSize,
	type Window as TauriWindow,
} from '@tauri-apps/api/window';

type WindowScaleRecoveryWindow = Pick<
	TauriWindow,
	'onScaleChanged' | 'onFocusChanged' | 'scaleFactor' | 'innerSize' | 'setSize'
>;

type DocumentRef = Pick<
	Document,
	'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

type RegisterWindowScaleRecoveryOptions = {
	isTauri?: boolean;
	currentWindow?: WindowScaleRecoveryWindow;
	documentRef?: DocumentRef;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
	getDevicePixelRatio?: () => number;
};

const SCALE_MISMATCH_EPSILON = 0.01;

export async function registerWindowScaleRecovery({
	isTauri = Boolean(window.__TAURI_INTERNALS__),
	currentWindow = getCurrentWindow(),
	documentRef = document,
	requestFrame = window.requestAnimationFrame.bind(window),
	cancelFrame = window.cancelAnimationFrame.bind(window),
	getDevicePixelRatio = () => window.devicePixelRatio,
}: RegisterWindowScaleRecoveryOptions = {}): Promise<() => void> {
	if (!isTauri) {
		return () => undefined;
	}

	let disposed = false;
	let scheduledFrame: number | null = null;
	let recoveryInFlight = false;

	const runRecoveryIfNeeded = async () => {
		try {
			const scaleFactor = await currentWindow.scaleFactor();
			if (
				Math.abs(getDevicePixelRatio() - scaleFactor) <= SCALE_MISMATCH_EPSILON
			) {
				return;
			}

			const currentSize = await currentWindow.innerSize();
			await currentWindow.setSize(
				new PhysicalSize(currentSize.width, currentSize.height),
			);
		} catch (error) {
			console.error('Failed to recover window scale after wake:', error);
		}
	};

	const scheduleRecovery = () => {
		if (
			disposed ||
			recoveryInFlight ||
			scheduledFrame !== null ||
			documentRef.visibilityState === 'hidden'
		) {
			return;
		}

		scheduledFrame = requestFrame(() => {
			scheduledFrame = null;
			if (disposed || recoveryInFlight) {
				return;
			}

			recoveryInFlight = true;
			void runRecoveryIfNeeded().finally(() => {
				recoveryInFlight = false;
			});
		});
	};

	const removeScaleListener = await currentWindow.onScaleChanged(() => {
		scheduleRecovery();
	});
	const removeFocusListener = await currentWindow.onFocusChanged(({ payload }) => {
		if (payload) {
			scheduleRecovery();
		}
	});

	const handleVisibilityChange = () => {
		if (documentRef.visibilityState === 'visible') {
			scheduleRecovery();
		}
	};
	documentRef.addEventListener('visibilitychange', handleVisibilityChange);

	return () => {
		disposed = true;
		if (scheduledFrame !== null) {
			cancelFrame(scheduledFrame);
			scheduledFrame = null;
		}
		documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
		removeScaleListener();
		removeFocusListener();
	};
}
