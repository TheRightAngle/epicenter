import type { Window as TauriWindow } from '@tauri-apps/api/window';

type MinimizeToTrayWindow = Pick<
	TauriWindow,
	'onResized' | 'isMinimized' | 'hide'
>;

type RegisterMinimizeToTrayOptions = {
	isTauri?: boolean;
	currentWindow?: MinimizeToTrayWindow;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
	isEnabled?: () => boolean;
};

export async function registerMinimizeToTray({
	isTauri = Boolean(window.__TAURI_INTERNALS__),
	currentWindow,
	requestFrame = window.requestAnimationFrame.bind(window),
	cancelFrame = window.cancelAnimationFrame.bind(window),
	isEnabled = () => false,
}: RegisterMinimizeToTrayOptions = {}): Promise<() => void> {
	if (!isTauri) {
		return () => undefined;
	}

	const resolvedWindow =
		currentWindow ??
		(await import('@tauri-apps/api/window')).getCurrentWindow();

	let disposed = false;
	let scheduledFrame: number | null = null;
	let hideInFlight = false;

	const scheduleHideIfNeeded = () => {
		if (disposed || hideInFlight || scheduledFrame !== null || !isEnabled()) {
			return;
		}

		scheduledFrame = requestFrame(() => {
			scheduledFrame = null;
			if (disposed || hideInFlight || !isEnabled()) {
				return;
			}

			hideInFlight = true;
			void resolvedWindow
				.isMinimized()
				.then(async (isMinimized) => {
					if (disposed || !isMinimized || !isEnabled()) {
						return;
					}

					await resolvedWindow.hide();
				})
				.catch((error) => {
					console.error('Failed to minimize Whispering to tray:', error);
				})
				.finally(() => {
					hideInFlight = false;
				});
		});
	};

	const removeResizeListener = await resolvedWindow.onResized(() => {
		scheduleHideIfNeeded();
	});

	return () => {
		disposed = true;
		if (scheduledFrame !== null) {
			cancelFrame(scheduledFrame);
			scheduledFrame = null;
		}
		removeResizeListener();
	};
}
