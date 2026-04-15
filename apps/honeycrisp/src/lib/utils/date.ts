import { DateTimeString } from '@epicenter/workspace';
import { differenceInDays, format, isToday, isYesterday } from 'date-fns';

/**
 * Get a human-readable date group label for note list grouping.
 *
 * Returns labels like "Today", "Yesterday", "Previous 7 Days",
 * "Previous 30 Days", or a month/year string for older dates.
 *
 * @example
 * ```typescript
 * import { getDateLabel } from '$lib/utils/date';
 *
 * const label = getDateLabel(note.updatedAt);
 * // "Today" | "Yesterday" | "Previous 7 Days" | "March 2026"
 * ```
 */
export function getDateLabel(dts: string): string {
	const date = DateTimeString.toDate(dts);
	if (isToday(date)) return 'Today';
	if (isYesterday(date)) return 'Yesterday';
	const daysAgo = differenceInDays(new Date(), date);
	if (daysAgo <= 7) return 'Previous 7 Days';
	if (daysAgo <= 30) return 'Previous 30 Days';
	return format(date, 'MMMM yyyy');
}
