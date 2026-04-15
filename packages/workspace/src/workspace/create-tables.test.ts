/**
 * createTables Tests
 *
 * Covers table helper creation over Y.Doc, including CRUD, filtering, and migration scenarios.
 * These tests ensure table APIs behave predictably for both direct writes and legacy rows read through migrations.
 *
 * Key behaviors:
 * - Table helpers expose consistent row status results for reads and deletes.
 * - Versioned table definitions migrate older row versions on read.
 */

import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import * as Y from 'yjs';
import type { YKeyValueLwwEntry } from '../shared/y-keyvalue/y-keyvalue-lww.js';
import { createTables } from './create-tables.js';
import { defineTable } from './define-table.js';

describe('createTables', () => {
	test('set stores a row that get returns as valid', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'Hello', _v: 1 });

		const result = tables.posts.get('1');
		expect(result.status).toBe('valid');
		if (result.status === 'valid') {
			expect(result.row).toEqual({ id: '1', title: 'Hello', _v: 1 });
		}
	});

	test('get returns not_found for missing row', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		const result = tables.posts.get('nonexistent');
		expect(result.status).toBe('not_found');
	});

	test('getAll returns all rows', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'First', _v: 1 });
		tables.posts.set({ id: '2', title: 'Second', _v: 1 });

		const results = tables.posts.getAll();
		expect(results).toHaveLength(2);
	});

	test('getAllValid returns only valid rows', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'Valid', _v: 1 });

		const rows = tables.posts.getAllValid();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ id: '1', title: 'Valid', _v: 1 });
	});

	test('filter returns matching rows', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(
				type({ id: 'string', title: 'string', published: 'boolean', _v: '1' }),
			),
		});

		tables.posts.set({ id: '1', title: 'Draft', published: false, _v: 1 });
		tables.posts.set({ id: '2', title: 'Published', published: true, _v: 1 });
		tables.posts.set({
			id: '3',
			title: 'Another Published',
			published: true,
			_v: 1,
		});

		const published = tables.posts.filter((row) => row.published);
		expect(published).toHaveLength(2);
	});

	test('find returns first matching row', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'First', _v: 1 });
		tables.posts.set({ id: '2', title: 'Second', _v: 1 });

		const found = tables.posts.find((row) => row.title === 'Second');
		expect(found).toEqual({ id: '2', title: 'Second', _v: 1 });
	});

	test('delete removes an existing row', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'Hello', _v: 1 });
		expect(tables.posts.has('1')).toBe(true);

		tables.posts.delete('1');
		expect(tables.posts.has('1')).toBe(false);
	});

	test('delete is a no-op for missing row', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		// Should not throw
		tables.posts.delete('nonexistent');
		expect(tables.posts.has('nonexistent')).toBe(false);
	});

	test('count reflects the current number of rows', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		expect(tables.posts.count()).toBe(0);

		tables.posts.set({ id: '1', title: 'First', _v: 1 });
		tables.posts.set({ id: '2', title: 'Second', _v: 1 });

		expect(tables.posts.count()).toBe(2);
	});

	test('clear removes all rows', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		tables.posts.set({ id: '1', title: 'First', _v: 1 });
		tables.posts.set({ id: '2', title: 'Second', _v: 1 });
		expect(tables.posts.count()).toBe(2);

		tables.posts.clear();
		expect(tables.posts.count()).toBe(0);
	});

	test('migrates old data on read', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(
				type({ id: 'string', title: 'string', _v: '1' }),
				type({ id: 'string', title: 'string', views: 'number', _v: '2' }),
			).migrate((row) => {
				if (row._v === 1) return { ...row, views: 0, _v: 2 };
				return row;
			}),
		});

		// Simulate writing old data by accessing the raw array
		const yarray = ydoc.getArray<YKeyValueLwwEntry<unknown>>('table:posts');
		yarray.push([
			{ key: '1', val: { id: '1', title: 'Old Post', _v: 1 }, ts: 0 },
		]);

		// Read should migrate
		const result = tables.posts.get('1');
		expect(result.status).toBe('valid');
		if (result.status === 'valid') {
			expect(result.row.views).toBe(0);
			expect(result.row._v).toBe(2);
		}
	});
});

describe('migration scenarios', () => {
	test('migrates three schema versions to latest', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(
				type({ id: 'string', title: 'string', _v: '1' }),
				type({ id: 'string', title: 'string', views: 'number', _v: '2' }),
				type({
					id: 'string',
					title: 'string',
					views: 'number',
					author: 'string | null',
					_v: '3',
				}),
			).migrate((row) => {
				if (row._v === 1) {
					return { ...row, views: 0, author: null, _v: 3 };
				}
				if (row._v === 2) {
					return { ...row, author: null, _v: 3 };
				}
				return row;
			}),
		});

		// Insert v1 data directly
		const yarray = ydoc.getArray<YKeyValueLwwEntry<unknown>>('table:posts');
		yarray.push([{ key: '1', val: { id: '1', title: 'Old', _v: 1 }, ts: 0 }]);
		yarray.push([
			{
				key: '2',
				val: { id: '2', title: 'Medium', views: 10, _v: 2 },
				ts: 0,
			},
		]);

		// Read should migrate both
		const v1Result = tables.posts.get('1');
		expect(v1Result.status).toBe('valid');
		if (v1Result.status === 'valid') {
			expect(v1Result.row._v).toBe(3);
			expect(v1Result.row.views).toBe(0);
			expect(v1Result.row.author).toBeNull();
		}

		const v2Result = tables.posts.get('2');
		expect(v2Result.status).toBe('valid');
		if (v2Result.status === 'valid') {
			expect(v2Result.row._v).toBe(3);
			expect(v2Result.row.views).toBe(10);
			expect(v2Result.row.author).toBeNull();
		}
	});

	test('migrates three schema versions including tags field', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(
				type({ id: 'string', title: 'string', _v: '1' }),
				type({ id: 'string', title: 'string', views: 'number', _v: '2' }),
				type({
					id: 'string',
					title: 'string',
					views: 'number',
					tags: 'string[]',
					_v: '3',
				}),
			).migrate((row) => {
				if (row._v === 1) {
					return { ...row, views: 0, tags: [], _v: 3 };
				}
				if (row._v === 2) {
					return { ...row, tags: [], _v: 3 };
				}
				return row;
			}),
		});

		// Insert v1 data
		const yarray = ydoc.getArray<YKeyValueLwwEntry<unknown>>('table:posts');
		yarray.push([{ key: '1', val: { id: '1', title: 'Old', _v: 1 }, ts: 0 }]);

		const result = tables.posts.get('1');
		expect(result.status).toBe('valid');
		if (result.status === 'valid') {
			expect(result.row.views).toBe(0);
			expect(result.row.tags).toEqual([]);
			expect(result.row._v).toBe(3);
		}
	});
});

describe('type errors', () => {
	test('rejects rows missing required fields for table.set', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		// @ts-expect-error title is required by the posts schema
		const _invalidSetInput: Parameters<typeof tables.posts.set>[0] = {
			id: '1',
		};
		void _invalidSetInput;
	});

	test('rejects access to tables not defined in schema', () => {
		const ydoc = new Y.Doc();
		const tables = createTables(ydoc, {
			posts: defineTable(type({ id: 'string', title: 'string', _v: '1' })),
		});

		// @ts-expect-error comments table is not defined on this workspace
		const _missingTable = tables.comments;
		void _missingTable;
	});
});
