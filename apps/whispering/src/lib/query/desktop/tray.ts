import { Ok, type Result } from 'wellcrafted/result';
import type { WhisperingRecordingState } from '$lib/constants/audio';
import { defineMutation } from '$lib/query/client';
import { WhisperingErr, type WhisperingError } from '$lib/result';
import { desktopServices } from '$lib/services/desktop';

const setTrayIconKeys = {
	setTrayIcon: ['setTrayIcon', 'setTrayIcon'] as const,
};

export const tray = {
	setTrayIcon: defineMutation({
		mutationKey: setTrayIconKeys.setTrayIcon,
		mutationFn: async ({
			icon,
		}: {
			icon: WhisperingRecordingState;
		}): Promise<Result<void, WhisperingError>> => {
			const { data, error } = await desktopServices.tray.setTrayIcon(icon);

			if (error) {
				return WhisperingErr({
					title: '⚠️ Failed to set tray icon',
					serviceError: error,
				});
			}

			return Ok(data);
		},
	}),
};
