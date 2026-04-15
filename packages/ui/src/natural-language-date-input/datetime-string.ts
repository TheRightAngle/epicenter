import type { DateTimeString } from '@epicenter/workspace';

/**
 * Convert a UTC `Date` and IANA timezone into Epicenter's `DateTimeString`
 * storage format.
 *
 * The returned value is intentionally plain text: the UTC instant comes first
 * for lexicographic sorting, and the timezone comes second so the original
 * local context is not lost.
 *
 * @param utcDate - The resolved UTC instant.
 * @param timezone - IANA timezone identifier that should travel with the date.
 * @returns A branded `DateTimeString` in `"<ISO>|<timezone>"` format.
 *
 * @example
 * ```typescript
 * const value = toDateTimeString(
 *   new Date('2024-01-01T20:00:00.000Z'),
 *   'America/New_York',
 * );
 *
 * // "2024-01-01T20:00:00.000Z|America/New_York"
 * ```
 */
export function toDateTimeString(utcDate: Date, timezone: string): DateTimeString {
	return `${utcDate.toISOString()}|${timezone}` as DateTimeString;
}

/**
 * Get the runtime's local IANA timezone identifier.
 *
 * Useful as the default timezone for natural-language input when the user
 * has not explicitly chosen one. Delegates to `Intl`, so the value comes
 * from the current environment rather than a hard-coded guess.
 *
 * @returns The environment's resolved IANA timezone.
 *
 * @example
 * ```typescript
 * const timezone = localTimezone();
 * // "America/Los_Angeles"
 * ```
 */
export function localTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
