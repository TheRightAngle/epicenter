import { describe, expect, it } from 'bun:test';

import { localTimezone, toDateTimeString } from './datetime-string.js';

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
