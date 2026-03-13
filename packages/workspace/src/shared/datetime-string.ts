/**
 * @fileoverview DateTimeString branded type and utilities
 *
 * A timezone-aware timestamp stored as a plain string. Designed for workspace
 * table schemas where dates need to be sortable, lossless, and portable.
 *
 * - **Storage format**: `"2024-01-01T20:00:00.000Z|America/New_York"`
 * - **Sortable**: UTC instant comes first, so lexicographic sort = chronological sort
 * - **Lossless**: Preserves the original timezone—unlike bare ISO strings that discard it
 * - **Portable**: Plain text, no binary encoding, grepable in any tool
 *
 * The pipe `|` separator is intentional—it never appears in valid ISO 8601 strings
 * or IANA timezone names, so parsing is always an unambiguous `split('|')`.
 */

import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';

/**
 * The ISO 8601 UTC instant portion of a {@link DateTimeString}.
 *
 * Always ends in `Z` (UTC). Example: `"2024-01-01T20:00:00.000Z"`.
 */
export type DateIsoString = string;

/**
 * An IANA timezone identifier.
 *
 * Example: `"America/New_York"`, `"Europe/London"`, `"Asia/Tokyo"`.
 *
 * @see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
 */
export type TimezoneId = string;

/**
 * Branded string representing a timezone-aware timestamp.
 *
 * Format: `"<ISO 8601 UTC>|<IANA timezone>"`.
 *
 * The pipe separator was chosen because it's invalid in both ISO 8601 dates and
 * IANA timezone names, making parsing unambiguous—just `split('|')` and you're done.
 *
 * Use this in workspace table schemas for `createdAt`/`updatedAt` fields.
 * The branded type prevents accidental mixing with plain strings at compile time.
 *
 * @example
 * ```typescript
 * import { DateTimeString, dateTimeStringNow } from '@epicenter/workspace';
 * import { type } from 'arktype';
 *
 * // In a table schema
 * const notesTable = defineTable(
 *   type({
 *     id: NoteId,
 *     createdAt: DateTimeString,
 *     updatedAt: DateTimeString,
 *     _v: '1',
 *   }),
 * );
 *
 * // Create a timestamp
 * const now = dateTimeStringNow(); // "2026-03-11T22:45:00.000Z|America/Los_Angeles"
 *
 * // Parse when you need date math
 * const [iso, tz] = (now as string).split('|');
 * ```
 */
export type DateTimeString = string & Brand<'DateTimeString'>;

/**
 * Arktype validator that brands a string as a {@link DateTimeString}.
 *
 * Validates that the string contains a `|` separator (the boundary between the
 * ISO 8601 UTC instant and the IANA timezone). This is a lightweight structural
 * check—it does not fully parse the ISO date or validate the timezone name,
 * keeping validation fast for hot paths like Yjs observe callbacks.
 *
 * Use directly in arktype schemas passed to `defineTable()`:
 *
 * @example
 * ```typescript
 * import { DateTimeString } from '@epicenter/workspace';
 * import { type } from 'arktype';
 *
 * const schema = type({
 *   createdAt: DateTimeString,
 *   updatedAt: DateTimeString,
 * });
 * ```
 */
export const DateTimeString = type('string').pipe((s): DateTimeString => {
	if (s.indexOf('|') === -1) {
		throw new Error(`Invalid DateTimeString: missing "|" separator in "${s}"`);
	}
	return s as DateTimeString;
});

/**
 * Create a {@link DateTimeString} for the current moment.
 *
 * Combines `new Date().toISOString()` (UTC instant) with the provided timezone
 * (or the system default) to produce a storable, sortable timestamp.
 *
 * @param timezone - IANA timezone identifier. Defaults to the system timezone
 *   via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 * @returns A branded DateTimeString in `"<ISO>|<timezone>"` format.
 *
 * @example
 * ```typescript
 * // System timezone
 * const now = dateTimeStringNow();
 * // "2026-03-11T22:45:00.000Z|America/Los_Angeles"
 *
 * // Explicit timezone
 * const tokyo = dateTimeStringNow('Asia/Tokyo');
 * // "2026-03-11T22:45:00.000Z|Asia/Tokyo"
 * ```
 */
export function dateTimeStringNow(timezone?: string): DateTimeString {
	const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	return `${new Date().toISOString()}|${tz}` as DateTimeString;
}
