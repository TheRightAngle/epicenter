import { describe, expect, it } from 'bun:test';

import { localTimezone, parseNaturalLanguageDate, toDateTimeString } from './parse-date.js';

function getTomorrowLocalDate() {
	const date = new Date();
	date.setDate(date.getDate() + 1);
	return date;
}

describe('parseNaturalLanguageDate', () => {
	it('returns null for empty and unparseable text', () => {
		expect(parseNaturalLanguageDate('', 'UTC')).toBeNull();
		expect(parseNaturalLanguageDate('asdfghjkl', 'UTC')).toBeNull();
	});

	it('parses tomorrow at 3pm with the expected components', () => {
		const expected = getTomorrowLocalDate();
		const parsed = parseNaturalLanguageDate('tomorrow at 3pm', 'America/New_York');

		expect(parsed).not.toBeNull();
		if (!parsed) {
			return;
		}

		expect(parsed.timezone).toBe('America/New_York');
		expect(Number.isNaN(parsed.utcDate.getTime())).toBe(false);
		expect(parsed.components).toEqual({
			year: expected.getFullYear(),
			month: expected.getMonth() + 1,
			day: expected.getDate(),
			hour: 15,
			minute: 0,
			second: 0,
		});
	});

	it('parses next tuesday', () => {
		const parsed = parseNaturalLanguageDate('next tuesday', 'UTC');

		expect(parsed).not.toBeNull();
		if (!parsed) {
			return;
		}

		expect(parsed.timezone).toBe('UTC');
		expect(Number.isNaN(parsed.utcDate.getTime())).toBe(false);
	});

	it('returns different UTC dates for different timezones', () => {
		const newYork = parseNaturalLanguageDate('tomorrow at 3pm', 'America/New_York');
		const utc = parseNaturalLanguageDate('tomorrow at 3pm', 'UTC');
		const tokyo = parseNaturalLanguageDate('tomorrow at 3pm', 'Asia/Tokyo');

		expect(newYork).not.toBeNull();
		expect(utc).not.toBeNull();
		expect(tokyo).not.toBeNull();
		if (!newYork || !utc || !tokyo) {
			return;
		}

		expect(newYork.components).toEqual(utc.components);
		expect(utc.components).toEqual(tokyo.components);
		expect(newYork.utcDate.getTime()).not.toBe(utc.utcDate.getTime());
		expect(utc.utcDate.getTime()).not.toBe(tokyo.utcDate.getTime());
		expect(newYork.utcDate.getTime()).not.toBe(tokyo.utcDate.getTime());
	});
});

describe('toDateTimeString', () => {
	it('formats UTC date and timezone with a pipe separator', () => {
		const value = toDateTimeString(new Date('2024-01-01T20:00:00.000Z'), 'America/New_York');

		expect(value).toBe('2024-01-01T20:00:00.000Z|America/New_York');
		expect(value).toContain('|');
		expect(value).toContain('America/New_York');
	});
});

describe('localTimezone', () => {
	it('returns a non-empty IANA timezone name', () => {
		const timezone = localTimezone();

		expect(timezone).not.toBe('');
		expect(timezone).toMatch(/\/|^UTC$/);
	});
});
