import { Ok, type Result } from 'wellcrafted/result';
import { defineMutation } from '$lib/query/client';
import { services } from '$lib/services';
import type { Event } from '$lib/services/analytics/types';
import { settings } from '$lib/state/settings.svelte';

const analyticsKeys = {
	logEvent: ['analytics', 'logEvent'] as const,
} as const;

/**
 * Analytics query layer that handles business logic for event logging.
 * Checks settings to determine if analytics is enabled before sending events.
 */
export const analytics = {
	/**
	 * Log an anonymous analytics event if analytics is enabled in settings
	 */
	logEvent: defineMutation({
		mutationKey: analyticsKeys.logEvent,
		mutationFn: async (event: Event): Promise<Result<void, never>> => {
			// Check if analytics is enabled in settings
			if (!settings.get('analytics.enabled')) {
				// Analytics disabled, skip anonymous analytics
				return Ok(undefined);
			}

			// Log the event using the stateless service
			await services.analytics.logEvent(event);
			return Ok(undefined);
		},
	}),
};
