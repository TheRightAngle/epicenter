import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createAwareness } from './create-awareness.js';
import type { AwarenessDefinitions } from './types.js';

const awarenessDefs = {
	cursorX: type('number'),
	cursorY: type('number'),
	name: type('string'),
} as AwarenessDefinitions;

function setup() {
	const ydoc = new Y.Doc({ guid: 'awareness-test' });
	const raw = new Awareness(ydoc);
	const awareness = createAwareness(raw, awarenessDefs);
	return { ydoc, raw, awareness };
}

describe('createAwareness', () => {
	test('setLocal() and getLocal() round-trip', () => {
		const { awareness } = setup();
		awareness.setLocal({ cursorX: 10, cursorY: 20, name: 'alice' });

		expect(awareness.getLocal()).toEqual({
			cursorX: 10,
			cursorY: 20,
			name: 'alice',
		});
	});

	test('setLocalField() updates single field', () => {
		const { awareness } = setup();
		awareness.setLocal({ name: 'alice' });
		awareness.setLocalField('cursorX', 1);

		expect(awareness.getLocal()).toEqual({
			name: 'alice',
			cursorX: 1,
		});
	});

	test('getLocalField() returns undefined when not set', () => {
		const { awareness } = setup();
		expect(awareness.getLocalField('cursorX')).toBeUndefined();
	});

	test('getAll() validates fields against schema', () => {
		const { awareness, raw } = setup();
		awareness.setLocal({ cursorX: 1 });
		raw.getStates().set(202, { cursorX: 'bad', name: 'remote' });

		const all = awareness.getAll();
		expect(all.get(202)).toEqual({ name: 'remote' });
	});

	test('getAll() skips clients with zero valid fields', () => {
		const { awareness, raw } = setup();
		raw.getStates().set(333, { cursorX: 'bad' });

		expect(awareness.getAll().has(333)).toBe(false);
	});

	test('getAll() includes clients with partial valid fields', () => {
		const { awareness, raw } = setup();
		raw.getStates().set(444, { cursorX: 'bad', name: 'valid' });

		expect(awareness.getAll().get(444)).toEqual({ name: 'valid' });
	});

	test('getAll() includes self', () => {
		const { awareness, raw } = setup();
		awareness.setLocal({ name: 'me' });

		expect(awareness.getAll().get(raw.clientID)).toEqual({ name: 'me' });
	});

	describe('peers()', () => {
		test('excludes self', () => {
			const { awareness, raw } = setup();
			awareness.setLocal({ name: 'self' });

			expect(awareness.peers().has(raw.clientID)).toBe(false);
		});

		test('includes remote peers with valid fields', () => {
			const { awareness, raw } = setup();
			raw.getStates().set(101, { name: 'remote', cursorX: 3, cursorY: 4 });

			expect(awareness.peers().get(101)).toEqual({
				name: 'remote',
				cursorX: 3,
				cursorY: 4,
			});
		});

		test('includes remote peers with zero valid fields (bare clients)', () => {
			const { awareness, raw } = setup();
			raw.getStates().set(102, { bogus: true });

			expect(awareness.peers().get(102)).toEqual({});
		});

		test('validates fields against schema (rejects invalid)', () => {
			const { awareness, raw } = setup();
			raw.getStates().set(103, { name: 123, cursorX: 'bad' });

			expect(awareness.peers().get(103)).toEqual({});
		});

		test('returns empty map when no remote peers', () => {
			const { awareness } = setup();
			expect(awareness.peers().size).toBe(0);
		});
	});

	test('observe() fires on awareness changes', () => {
		const { awareness } = setup();
		let calls = 0;

		const unobserve = awareness.observe(() => {
			calls++;
		});

		awareness.setLocal({ name: 'alice' });
		expect(calls).toBe(1);

		unobserve();
	});

	test('observe() returns unsubscribe function', () => {
		const { awareness } = setup();
		let calls = 0;

		const unobserve = awareness.observe(() => {
			calls++;
		});

		unobserve();
		awareness.setLocal({ name: 'alice' });

		expect(calls).toBe(0);
	});
});
