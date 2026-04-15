import { Ok, type Result } from 'wellcrafted/result';
import type { WhisperingSoundNames } from '$lib/constants/sounds';
import { defineMutation } from '$lib/query/client';
import { services } from '$lib/services';
import type { SoundError } from '$lib/services/sound';
import { settings } from '$lib/state/settings.svelte';

const soundKeys = {
	all: ['sound'] as const,
	playSoundIfEnabled: ['sound', 'playSoundIfEnabled'] as const,
} as const;

const soundSettingKeyMap = {
	'manual-start': 'sound.manualStart',
	'manual-stop': 'sound.manualStop',
	'manual-cancel': 'sound.manualCancel',
	'vad-start': 'sound.vadStart',
	'vad-capture': 'sound.vadCapture',
	'vad-stop': 'sound.vadStop',
	transcriptionComplete: 'sound.transcriptionComplete',
	transformationComplete: 'sound.transformationComplete',
} as const satisfies Record<WhisperingSoundNames, string>;

export const sound = {
	playSoundIfEnabled: defineMutation({
		mutationKey: soundKeys.playSoundIfEnabled,
		mutationFn: async (
			soundName: WhisperingSoundNames,
		): Promise<Result<void, SoundError>> => {
			if (!settings.get(soundSettingKeyMap[soundName])) {
				return Ok(undefined);
			}
			return await services.sound.playSound(soundName);
		},
	}),
};
