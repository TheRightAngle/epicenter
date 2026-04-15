/**
 * Shared date/time formatting utilities for Fuji.
 *
 * Centralizes `DateTimeString` → display string conversions so
 * components don't duplicate formatting logic.
 */

import { DateTimeString } from '@epicenter/workspace';
import { formatDistanceToNowStrict } from 'date-fns';

/**
 * Format a `DateTimeString` as a human-readable relative time.
 *
 * Returns strings like "3 minutes ago", "2 days ago". Falls back
 * to the raw string if parsing fails (e.g., malformed data from
 * an older schema version).
 */
export function relativeTime(dts: string): string {
	try {
		return formatDistanceToNowStrict(DateTimeString.toDate(dts), {
			addSuffix: true,
		});
	} catch {
		return dts;
	}
}
