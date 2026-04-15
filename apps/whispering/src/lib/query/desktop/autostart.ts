import { Ok } from 'wellcrafted/result';
import { defineMutation, defineQuery, queryClient } from '$lib/query/client';
import { WhisperingErr } from '$lib/result';
import { desktopServices } from '$lib/services/desktop';

const autostartKeys = {
	all: ['autostart'] as const,
	isEnabled: ['autostart', 'isEnabled'] as const,
	enable: ['autostart', 'enable'] as const,
	disable: ['autostart', 'disable'] as const,
} as const;

const invalidateAutostartState = () =>
	queryClient.invalidateQueries({ queryKey: autostartKeys.isEnabled });

export const autostart = {
	isEnabled: defineQuery({
		queryKey: autostartKeys.isEnabled,
		queryFn: async () => {
			const { data, error } = await desktopServices.autostart.isEnabled();
			if (error) {
				return WhisperingErr({
					title: '❌ Failed to check autostart status',
					serviceError: error,
				});
			}
			return Ok(data);
		},
		initialData: false,
	}),

	enable: defineMutation({
		mutationKey: autostartKeys.enable,
		mutationFn: async () => {
			const { data, error } = await desktopServices.autostart.enable();
			if (error) {
				return WhisperingErr({
					title: '❌ Failed to enable autostart',
					serviceError: error,
				});
			}
			return Ok(data);
		},
		onSettled: invalidateAutostartState,
	}),

	disable: defineMutation({
		mutationKey: autostartKeys.disable,
		mutationFn: async () => {
			const { data, error } = await desktopServices.autostart.disable();
			if (error) {
				return WhisperingErr({
					title: '❌ Failed to disable autostart',
					serviceError: error,
				});
			}
			return Ok(data);
		},
		onSettled: invalidateAutostartState,
	}),
};
