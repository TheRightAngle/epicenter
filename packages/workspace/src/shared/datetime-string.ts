/**
 * @fileoverview DateTimeString branded type and companion object
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
 *
 * The `DateTimeString` export is both an arktype validator (for `defineTable` schemas)
 * and a companion object with `parse`, `stringify`, `is`, and `now` methods—modeled
 * after `JSON.parse` / `JSON.stringify` for familiarity.
 */

import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';

// ─── Regex ───────────────────────────────────────────────────────────────────

/**
 * Strict 24-character UTC format produced by `Date.toISOString()`.
 *
 * Format: `YYYY-MM-DDTHH:mm:ss.sssZ` (exactly 24 characters).
 * Ensures consistent storage length and correct lexicographic sorting.
 */
const ISO_UTC_EXACT_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

/**
 * IANA timezone identifier pattern.
 *
 * Starts with a letter, then allows letters, digits, underscores, forward
 * slashes, hyphens, and plus signs. Covers all valid IANA timezone names
 * (e.g. `America/New_York`, `Etc/GMT+5`, `UTC`).
 */
const TIMEZONE_ID_REGEX = /[A-Za-z][A-Za-z0-9_/+-]*/;

/**
 * Full DateTimeString validation pattern.
 *
 * Anchored match of `<ISO_UTC_EXACT>|<TIMEZONE_ID>` — rejects malformed
 * strings that a bare `indexOf('|')` check would accept (e.g. `"hello|world"`).
 */
const DATE_TIME_STRING_REGEX = new RegExp(
	`^(${ISO_UTC_EXACT_REGEX.source})\\|(${TIMEZONE_ID_REGEX.source})$`,
);

// ─── Branded types ───────────────────────────────────────────────────────────

/**
 * The ISO 8601 UTC instant portion of a {@link DateTimeString}.
 *
 * Always exactly 24 characters ending in `Z` (UTC).
 *
 * @example `"2024-01-01T20:00:00.000Z"`
 */
export type DateIsoString = string & Brand<'DateIsoString'>;

/**
 * An IANA timezone identifier.
 *
 * @example `"America/New_York"`, `"Europe/London"`, `"Asia/Tokyo"`, `"UTC"`
 * @see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
 */
export type TimezoneId = string & Brand<'TimezoneId'>;

/**
 * Branded string representing a timezone-aware timestamp.
 *
 * Format: `"<ISO 8601 UTC>|<IANA timezone>"`.
 *
 * The pipe separator was chosen because it's invalid in both ISO 8601 dates and
 * IANA timezone names, making parsing unambiguous.
 *
 * Use this in workspace table schemas for `createdAt`/`updatedAt` fields.
 * The branded type prevents accidental mixing with plain strings at compile time.
 *
 * @example
 * ```typescript
 * import { DateTimeString } from '@epicenter/workspace';
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
 * const now = DateTimeString.now(); // "2026-03-11T22:45:00.000Z|America/Los_Angeles"
 *
 * // Parse when you need the components
 * const { iso, timezone } = DateTimeString.parse(now);
 *
 * // Stringify components back
 * const roundTripped = DateTimeString.stringify(iso, timezone);
 *
 * // Type guard
 * if (DateTimeString.is(unknownValue)) {
 *   // unknownValue is DateTimeString
 * }
 * ```
 */
export type DateTimeString = string & Brand<'DateTimeString'>;

/**
 * The result of parsing a {@link DateTimeString} into its two components.
 *
 * @example
 * ```typescript
 * const { iso, timezone } = DateTimeString.parse(stored);
 * const date = new Date(iso);  // when you need a Date object
 * ```
 */
export type ParsedDateTimeString = {
	iso: DateIsoString;
	timezone: TimezoneId;
};

// ─── Arktype validator (base) ────────────────────────────────────────────────

const validator = type('string').pipe((s): DateTimeString => {
	if (!DATE_TIME_STRING_REGEX.test(s)) {
		throw new Error(
			`Invalid DateTimeString: "${s}" does not match "YYYY-MM-DDTHH:mm:ss.sssZ|Timezone"`,
		);
	}
	return s as DateTimeString;
});

// ─── Companion object ────────────────────────────────────────────────────────

/**
 * Arktype validator and companion object for {@link DateTimeString}.
 *
 * Works as an arktype schema in `defineTable` (it IS a `Type`), and also
 * provides `parse`, `stringify`, `is`, and `now` methods—modeled after
 * `JSON.parse` / `JSON.stringify`.
 *
 * @example
 * ```typescript
 * // As an arktype schema (unchanged from before)
 * const schema = type({ createdAt: DateTimeString });
 *
 * // As a companion object
 * const now = DateTimeString.now();
 * const { iso, timezone } = DateTimeString.parse(now);
 * const rebuilt = DateTimeString.stringify(iso, timezone);
 * DateTimeString.is(someValue); // type guard
 * ```
 */
export const DateTimeString = Object.assign(validator, {
	/**
	 * Type guard—check if a value is a valid {@link DateTimeString}.
	 *
	 * Uses strict regex validation: 24-char UTC ISO prefix + pipe + valid IANA
	 * timezone characters. Rejects malformed strings that a bare `indexOf('|')`
	 * check would accept.
	 *
	 * @example
	 * ```typescript
	 * if (DateTimeString.is(raw)) {
	 *   const { iso, timezone } = DateTimeString.parse(raw);
	 * }
	 * ```
	 */
	is(value: unknown): value is DateTimeString {
		if (typeof value !== 'string') return false;
		return DATE_TIME_STRING_REGEX.test(value);
	},

	/**
	 * Parse a {@link DateTimeString} into its ISO instant and timezone components.
	 *
	 * Use `DateTimeString.is()` first if the input hasn't been validated. Throws
	 * on malformed input.
	 *
	 * @param str - A DateTimeString to decompose.
	 * @returns The ISO UTC instant and IANA timezone as branded strings.
	 *
	 * @example
	 * ```typescript
	 * const stored: DateTimeString = row.createdAt;
	 * const { iso, timezone } = DateTimeString.parse(stored);
	 * const date = new Date(iso);
	 * ```
	 */
	parse(str: string): ParsedDateTimeString {
		if (!DATE_TIME_STRING_REGEX.test(str)) {
			throw new Error(
				`Invalid DateTimeString: "${str}" does not match "YYYY-MM-DDTHH:mm:ss.sssZ|Timezone"`,
			);
		}
		return {
			iso: str.slice(0, 24) as DateIsoString,
			timezone: str.slice(25) as TimezoneId,
		};
	},

	/**
	 * Build a {@link DateTimeString} from an ISO UTC instant and timezone.
	 *
	 * The inverse of `parse`—takes the two components and joins them with `|`.
	 *
	 * @param iso - ISO 8601 UTC string (e.g. from `Date.toISOString()`).
	 * @param timezone - IANA timezone identifier.
	 * @returns A branded DateTimeString.
	 *
	 * @example
	 * ```typescript
	 * const stored = DateTimeString.stringify(
	 *   new Date().toISOString(),
	 *   'America/New_York',
	 * );
	 * ```
	 */
	stringify(iso: string, timezone: string): DateTimeString {
		return `${iso}|${timezone}` as DateTimeString;
	},

	/**
	 * Create a {@link DateTimeString} for the current moment.
	 *
	 * Combines `new Date().toISOString()` (UTC instant) with the provided
	 * timezone (or the system default) to produce a storable, sortable timestamp.
	 *
	 * @param timezone - IANA timezone identifier. Defaults to the system timezone
	 *   via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
	 * @returns A branded DateTimeString in `"<ISO>|<timezone>"` format.
	 *
	 * @example
	 * ```typescript
	 * const now = DateTimeString.now();
	 * // "2026-03-11T22:45:00.000Z|America/Los_Angeles"
	 *
	 * const tokyo = DateTimeString.now('Asia/Tokyo');
	 * // "2026-03-11T22:45:00.000Z|Asia/Tokyo"
	 * ```
	 */
	now(timezone?: string): DateTimeString {
		const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
		return `${new Date().toISOString()}|${tz}` as DateTimeString;
	},
	/**
	 * Convert a {@link DateTimeString} to a native `Date` object.
	 *
	 * Extracts the ISO UTC instant and constructs a `Date`. The timezone
	 * component is discarded—use `parse()` when you need it.
	 *
	 * @param str - A DateTimeString (or any string in the expected format).
	 * @returns A native `Date` representing the UTC instant.
	 *
	 * @example
	 * ```typescript
	 * const date = DateTimeString.toDate(note.updatedAt);
	 * format(date, 'h:mm a'); // "3:42 PM"
	 * ```
	 */
	toDate(str: string): Date {
		return new Date(str.slice(0, 24));
	},
});
