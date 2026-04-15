import type { DateTimeString } from '@epicenter/workspace';
import * as chrono from 'chrono-node/en';

export type DateComponents = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

export type ParseNaturalLanguageDateResult = {
	utcDate: Date;
	timezone: string;
	components: DateComponents;
};

/**
 * Parse natural-language date text into a UTC instant plus its source timezone.
 *
 * This is the bridge between chrono's English parser and Epicenter's
 * timezone-aware storage format. Chrono understands phrases like
 * `"tomorrow at 9"` or `"next friday 2:30pm"`, but it does not accept IANA
 * timezone names like `"America/New_York"` directly. To get around that, this
 * function parses the human text into date/time components first, then resolves
 * those components against the supplied IANA timezone with `Intl`.
 *
 * The timezone resolution is DST-safe because the offset is derived from the
 * target date itself—not from the current date. That means winter dates use the
 * winter offset, summer dates use the summer offset, and spring-forward gaps are
 * bridged using the offset that applies at that local moment.
 *
 * @param text - Natural-language date text in English.
 * @param timezone - IANA timezone identifier such as `"America/New_York"`.
 * @returns A UTC `Date`, the original timezone, and the parsed wall-clock
 *   components—or `null` when the text cannot be parsed or the timezone is
 *   invalid.
 *
 * @example
 * ```typescript
 * const parsed = parseNaturalLanguageDate('tomorrow at 9am', 'America/New_York');
 *
 * if (!parsed) {
 *   throw new Error('Could not understand that date');
 * }
 *
 * parsed.components.hour;
 * // 9
 *
 * parsed.utcDate.toISOString();
 * // "2026-04-09T13:00:00.000Z" (during EDT)
 * ```
 *
 * @example
 * ```typescript
 * const parsed = parseNaturalLanguageDate('march 10 2024 2:30am', 'America/New_York');
 *
 * // During the DST spring-forward gap, the local wall time does not exist.
 * // The resolver bridges to the matching UTC instant using the target date's
 * // timezone rules instead of today's offset.
 * parsed?.utcDate.toISOString();
 * ```
 */
export function parseNaturalLanguageDate(
	text: string,
	timezone: string,
): ParseNaturalLanguageDateResult | null {
	const parsedResults = chrono.parse(text, new Date());
	const result = parsedResults[0];

	if (!result) {
		return null;
	}

	const components = extractDateComponents(result.start);
	if (!components) {
		return null;
	}

	const roughUtcDate = new Date(
		Date.UTC(
			components.year,
			components.month - 1,
			components.day,
			components.hour,
			components.minute,
			components.second,
		),
	);

	if (!isValidDate(roughUtcDate)) {
		return null;
	}

	const offsetMilliseconds = getOffsetMillisecondsForTimezone(roughUtcDate, timezone);
	if (offsetMilliseconds === null) {
		return null;
	}

	const utcDate = new Date(roughUtcDate.getTime() - offsetMilliseconds);
	if (!isValidDate(utcDate)) {
		return null;
	}

	return {
		utcDate,
		timezone,
		components,
	};
}

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
 *
 * @example
 * ```typescript
 * const parsed = parseNaturalLanguageDate('next friday at 6pm', 'Europe/London');
 *
 * const value = parsed
 *   ? toDateTimeString(parsed.utcDate, parsed.timezone)
 *   : null;
 * ```
 */
export function toDateTimeString(utcDate: Date, timezone: string): DateTimeString {
	return `${utcDate.toISOString()}|${timezone}` as DateTimeString;
}

/**
 * Get the runtime's local IANA timezone identifier.
 *
 * This is useful as the default timezone for natural-language input when the
 * user has not explicitly chosen one. It delegates to `Intl`, so the exact
 * value comes from the current environment rather than a hard-coded guess.
 *
 * @returns The environment's resolved IANA timezone.
 *
 * @example
 * ```typescript
 * const timezone = localTimezone();
 * // "America/Los_Angeles"
 * ```
 *
 * @example
 * ```typescript
 * const parsed = parseNaturalLanguageDate('today 5pm', localTimezone());
 * ```
 */
export function localTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function extractDateComponents(
	components: chrono.ParsingComponents,
): DateComponents | null {
	const year = components.get('year');
	const month = components.get('month');
	const day = components.get('day');
	const hour = components.get('hour') ?? 0;
	const minute = components.get('minute') ?? 0;
	const second = components.get('second') ?? 0;

	if (year === null || month === null || day === null) {
		return null;
	}

	return {
		year,
		month,
		day,
		hour,
		minute,
		second,
	};
}

function getOffsetMillisecondsForTimezone(instant: Date, timezone: string): number | null {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			timeZoneName: 'longOffset',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		});

		const timeZonePart = formatter
			.formatToParts(instant)
			.find((part) => part.type === 'timeZoneName')?.value;

		if (!timeZonePart) {
			return null;
		}

		if (timeZonePart === 'GMT' || timeZonePart === 'UTC') {
			return 0;
		}

		const match = /^(?:GMT|UTC)([+-])(\d{2})(?::?(\d{2}))?$/.exec(timeZonePart);
		if (!match) {
			return null;
		}

		const [, sign, hoursText, minutesText] = match;
		const hours = Number(hoursText);
		const minutes = Number(minutesText ?? '0');
		const offsetMilliseconds = (hours * 60 + minutes) * 60 * 1000;

		return sign === '+' ? offsetMilliseconds : -offsetMilliseconds;
	} catch {
		return null;
	}
}

function isValidDate(value: Date): boolean {
	return Number.isFinite(value.getTime());
}
