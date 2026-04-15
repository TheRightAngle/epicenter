import type { Window as TauriWindow } from '@tauri-apps/api/window';

type WindowScaleRecoveryWindow = Pick<
	TauriWindow,
	'onScaleChanged' | 'onFocusChanged' | 'scaleFactor' | 'innerSize' | 'setSize'
>;

type WindowScaleSampleWindow = Pick<
	TauriWindow,
	'scaleFactor' | 'innerSize' | 'setSize'
>;

const SCALE_MISMATCH_EPSILON_FOR_EXPORT = 0.01;

/**
 * One-shot scale recovery — call this when you know the window has just
 * been re-shown (e.g., from the tray) and the resident DPR may not match
 * the OS-reported scale factor.
 *
 * Idempotent: returns immediately if no mismatch is observed. Safe to
 * call alongside the persistent listener installed by
 * `registerWindowScaleRecovery` — the listener ignores in-flight runs.
 */
export async function recoverWindowScaleNow(
	currentWindow?: WindowScaleSampleWindow,
	getDevicePixelRatio: () => number = () => window.devicePixelRatio,
): Promise<void> {
	const win =
		currentWindow ??
		(await import('@tauri-apps/api/window')).getCurrentWindow();
	try {
		const scaleFactor = await win.scaleFactor();
		if (
			Math.abs(getDevicePixelRatio() - scaleFactor) <=
			SCALE_MISMATCH_EPSILON_FOR_EXPORT
		) {
			return;
		}
		const currentSize = await win.innerSize();
		const { PhysicalSize } = await import('@tauri-apps/api/window');
		await win.setSize(new PhysicalSize(currentSize.width, currentSize.height));
	} catch (error) {
		console.error('Failed to recover window scale on demand:', error);
	}
}

type WindowSizeArg = Parameters<WindowScaleRecoveryWindow['setSize']>[0];

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
	createSize?: (width: number, height: number) => WindowSizeArg;
};

const SCALE_MISMATCH_EPSILON = 0.01;

export async function registerWindowScaleRecovery({
	isTauri = Boolean(window.__TAURI_INTERNALS__),
	currentWindow,
	documentRef = document,
	requestFrame = window.requestAnimationFrame.bind(window),
	cancelFrame = window.cancelAnimationFrame.bind(window),
	getDevicePixelRatio = () => window.devicePixelRatio,
	createSize = (width, height) => ({ width, height }) as WindowSizeArg,
}: RegisterWindowScaleRecoveryOptions = {}): Promise<() => void> {
	if (!isTauri) {
		return () => undefined;
	}

	const resolvedWindow =
		currentWindow ??
		(await import('@tauri-apps/api/window')).getCurrentWindow();
	const resolvedCreateSize: (
		width: number,
		height: number,
	) => Promise<WindowSizeArg> =
		currentWindow === undefined
			? async (width: number, height: number) => {
					const { PhysicalSize } = await import('@tauri-apps/api/window');
					return new PhysicalSize(width, height) as WindowSizeArg;
				}
			: async (width: number, height: number) => createSize(width, height);

	let disposed = false;
	let scheduledFrame: number | null = null;
	let recoveryInFlight = false;

	const runRecoveryIfNeeded = async () => {
		try {
			const scaleFactor = await resolvedWindow.scaleFactor();
			if (
				Math.abs(getDevicePixelRatio() - scaleFactor) <= SCALE_MISMATCH_EPSILON
			) {
				return;
			}

			const currentSize = await resolvedWindow.innerSize();
			await resolvedWindow.setSize(
				await resolvedCreateSize(currentSize.width, currentSize.height),
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

	const removeScaleListener = await resolvedWindow.onScaleChanged(() => {
		scheduleRecovery();
	});
	const removeFocusListener = await resolvedWindow.onFocusChanged(({ payload }) => {
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
