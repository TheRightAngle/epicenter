/**
 * DDL Generation Tests
 *
 * Verifies JSON Schema → CREATE TABLE SQL conversion for the SQLite materializer.
 * Covers single-version tables, multi-version tables (oneOf resolution),
 * all JSON Schema type mappings, nullable vs NOT NULL, and edge cases.
 *
 * Key behaviors:
 * - resolveSchema picks highest _v.const from oneOf array
 * - generateDdl maps JSON Schema types to correct SQLite types
 * - id field always becomes TEXT PRIMARY KEY
 * - _v field with const always becomes INTEGER NOT NULL
 * - required fields get NOT NULL, optional fields allow NULL
 * - object/array types serialize to TEXT (JSON)
 * - enum types map to TEXT
 */

import { describe, expect, test } from 'bun:test';
import { generateDdl, resolveSchema } from './ddl.js';

type JsonSchema = Record<string, unknown>;

function objectSchema(
	properties: Record<string, Record<string, unknown>>,
	required: string[] = [],
) {
	return { type: 'object' as const, properties, required };
}

function versionedSchema(
	version: number,
	properties: Record<string, Record<string, unknown>> = {},
	required: string[] = [],
) {
	return objectSchema(
		{
			id: { type: 'string' },
			_v: { const: version },
			...properties,
		},
		['id', '_v', ...required],
	);
}

describe('resolveSchema', () => {
	test('returns schema as-is when no oneOf present', () => {
		const schema = objectSchema(
			{ id: { type: 'string' }, title: { type: 'string' } },
			['id'],
		);

		expect(resolveSchema(schema)).toBe(schema);
	});

	test('picks highest _v.const from oneOf array', () => {
		const v1Schema = versionedSchema(1, { title: { type: 'string' } }, [
			'title',
		]);
		const v2Schema = versionedSchema(
			2,
			{ title: { type: 'string' }, published: { type: 'boolean' } },
			['title'],
		);

		expect(resolveSchema({ oneOf: [v1Schema, v2Schema] })).toBe(v2Schema);
	});

	test('picks highest _v.const when versions are out of order', () => {
		const v1Schema = versionedSchema(1, { title: { type: 'string' } }, [
			'title',
		]);
		const v2Schema = versionedSchema(
			2,
			{ title: { type: 'string' }, published: { type: 'boolean' } },
			['title'],
		);

		expect(resolveSchema({ oneOf: [v2Schema, v1Schema] })).toBe(v2Schema);
	});

	test('returns original schema when oneOf is empty', () => {
		const schema: JsonSchema = { oneOf: [] };

		expect(resolveSchema(schema)).toBe(schema);
	});

	test('returns first oneOf entry when oneOf entries lack _v', () => {
		const firstSchema = objectSchema({ title: { type: 'string' } }, ['title']);
		const secondSchema = objectSchema({ published: { type: 'boolean' } });

		expect(resolveSchema({ oneOf: [firstSchema, secondSchema] })).toBe(
			firstSchema,
		);
	});

	test.todo('returns original schema when oneOf entries lack _v', () => {});
});

describe('generateDdl', () => {
	test('generates correct DDL for a simple table', () => {
		const schema = {
			type: 'object',
			properties: {
				id: { type: 'string' },
				_v: { const: 1 },
				title: { type: 'string' },
				published: { type: 'boolean' },
			},
			required: ['id', '_v', 'title'],
		};

		const sql = generateDdl('posts', schema);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("id" TEXT PRIMARY KEY, "_v" INTEGER NOT NULL, "title" TEXT NOT NULL, "published" INTEGER)',
		);
	});

	test('maps string type to TEXT', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ title: { type: 'string' } }, ['title']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("title" TEXT NOT NULL)',
		);
	});

	test('maps number type to REAL', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ score: { type: 'number' } }, ['score']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("score" REAL NOT NULL)',
		);
	});

	test('maps integer type to INTEGER', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ count: { type: 'integer' } }, ['count']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("count" INTEGER NOT NULL)',
		);
	});

	test('maps boolean type to INTEGER', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ published: { type: 'boolean' } }, ['published']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("published" INTEGER NOT NULL)',
		);
	});

	test('maps enum to TEXT', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ status: { enum: ['A', 'B'] } }, ['status']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("status" TEXT NOT NULL)',
		);
	});

	test('maps required object type to TEXT NOT NULL', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ metadata: { type: 'object' } }, ['metadata']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("metadata" TEXT NOT NULL)',
		);
	});

	test('maps required array type to TEXT NOT NULL', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ tags: { type: 'array' } }, ['tags']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("tags" TEXT NOT NULL)',
		);
	});

	test('optional fields omit NOT NULL', () => {
		const sql = generateDdl(
			'posts',
			objectSchema({ title: { type: 'string' } }),
		);

		expect(sql).toBe('CREATE TABLE IF NOT EXISTS "posts" ("title" TEXT)');
	});

	test('id field is always TEXT PRIMARY KEY regardless of required', () => {
		const sql = generateDdl('posts', objectSchema({ id: { type: 'string' } }));

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("id" TEXT PRIMARY KEY)',
		);
	});

	test('handles multi-version schema via oneOf', () => {
		const v1Schema = versionedSchema(1, { title: { type: 'string' } }, [
			'title',
		]);
		const v2Schema = versionedSchema(
			2,
			{
				title: { type: 'string' },
				published: { type: 'boolean' },
			},
			['title'],
		);

		const sql = generateDdl('posts', { oneOf: [v1Schema, v2Schema] });

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("id" TEXT PRIMARY KEY, "_v" INTEGER NOT NULL, "title" TEXT NOT NULL, "published" INTEGER)',
		);
	});

	test('quotes table name with double quotes', () => {
		const sql = generateDdl(
			'select',
			objectSchema({ id: { type: 'string' } }, ['id']),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "select" ("id" TEXT PRIMARY KEY)',
		);
	});

	test('quotes column names with double quotes', () => {
		const sql = generateDdl(
			'posts',
			objectSchema(
				{
					select: { type: 'string' },
					'say"hi"': { type: 'string' },
				},
				['select', 'say"hi"'],
			),
		);

		expect(sql).toBe(
			'CREATE TABLE IF NOT EXISTS "posts" ("select" TEXT NOT NULL, "say""hi""" TEXT NOT NULL)',
		);
	});
});
