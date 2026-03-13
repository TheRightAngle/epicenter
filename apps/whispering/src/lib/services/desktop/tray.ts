import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { resolveResource } from '@tauri-apps/api/path';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
// import { commandCallbacks } from '$lib/commands';
import { tryAsync } from 'wellcrafted/result';
import { goto } from '$app/navigation';
// import { extension } from '@epicenter/extension';
import type { WhisperingRecordingState } from '$lib/constants/audio';

const TRAY_ID = 'whispering-tray';

const TrayError = defineErrors({
	SetIcon: ({ cause }: { cause: unknown }) => ({
		message: `Failed to set tray icon: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type TrayError = InferErrors<typeof TrayError>;

const trayPromise = initTray();

export const TrayIconServiceLive = {
	setTrayIcon: (recorderState: WhisperingRecordingState) =>
		tryAsync({
			try: async () => {
				const iconPath = await getIconPath(recorderState);
				const tray = await trayPromise;
				return tray.setIcon(iconPath);
			},
			catch: (error) =>
				TrayError.SetIcon({
					cause: error,
				}),
		}),
};

export type TrayIconService = typeof TrayIconServiceLive;

async function initTray() {
	const existingTray = await TrayIcon.getById(TRAY_ID);
	if (existingTray) return existingTray;

	const trayMenu = await Menu.new({
		items: [
			// Window Controls Section
			await MenuItem.new({
				id: 'show',
				text: 'Show Window',
				action: async () => {
					const currentWindow = getCurrentWindow();
					await currentWindow.unminimize();
					await currentWindow.show();
				},
			}),

			await MenuItem.new({
				id: 'hide',
				text: 'Hide Window',
				action: () => getCurrentWindow().hide(),
			}),

			// Settings Section
			await MenuItem.new({
				id: 'settings',
				text: 'Settings',
				action: () => {
					goto('/settings');
					return getCurrentWindow().show();
				},
			}),

			// Quit Section
			await MenuItem.new({
				id: 'quit',
				text: 'Quit',
				action: () => void exit(0),
			}),
		],
	});

	const tray = await TrayIcon.new({
		id: TRAY_ID,
		icon: await getIconPath('IDLE'),
		menu: trayMenu,
		menuOnLeftClick: false,
		action: (e) => {
			if (
				e.type === 'Click' &&
				e.button === 'Left' &&
				e.buttonState === 'Down'
			) {
				// commandCallbacks.toggleManualRecording();
				return true;
			}
			return false;
		},
	});

	return tray;
}

async function getIconPath(recorderState: WhisperingRecordingState) {
	const iconPaths = {
		IDLE: 'recorder-state-icons/studio_microphone.png',
		RECORDING: 'recorder-state-icons/red_large_square.png',
	} as const satisfies Record<WhisperingRecordingState, string>;
	return await resolveResource(iconPaths[recorderState]);
}
