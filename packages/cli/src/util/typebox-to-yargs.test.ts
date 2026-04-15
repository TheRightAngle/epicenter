/**
 * TypeBox-to-Yargs Conversion Tests
 *
 * Verifies that TypeBox schemas are correctly translated into yargs option
 * definitions so CLI flags match the workspace contract types.
 *
 * Key behaviors:
 * - Maps TypeBox primitives (string, number, boolean, array) to yargs types
 * - Extracts literal unions and enums as yargs choices
 * - Propagates description and default metadata
 * - Marks optional fields as non-required
 */

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import { typeboxToYargsOptions } from './typebox-to-yargs';

describe('typeboxToYargsOptions', () => {
	describe('type mapping', () => {
		test('string field', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ title: Type.String() }),
			);
			expect(options.title).toMatchObject({
				type: 'string',
				demandOption: true,
			});
		});

		test('number field', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ count: Type.Number() }),
			);
			expect(options.count).toMatchObject({
				type: 'number',
				demandOption: true,
			});
		});

		test('integer maps to number', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ count: Type.Integer() }),
			);
			expect(options.count?.type).toBe('number');
		});

		test('boolean field', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ published: Type.Boolean() }),
			);
			expect(options.published).toMatchObject({
				type: 'boolean',
				demandOption: true,
			});
		});

		test('array field', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ tags: Type.Array(Type.String()) }),
			);
			expect(options.tags?.type).toBe('array');
		});

		test('optional field is not required', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ title: Type.Optional(Type.String()) }),
			);
			expect(options.title).toMatchObject({
				type: 'string',
				demandOption: false,
			});
		});

		test('nested object field has no yargs type', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ metadata: Type.Object({ nested: Type.String() }) }),
			);
			expect(options.metadata?.type).toBeUndefined();
			expect(options.metadata?.demandOption).toBe(true);
		});
	});

	describe('choices extraction', () => {
		test('string literal union becomes choices', () => {
			const options = typeboxToYargsOptions(
				Type.Object({
					status: Type.Union([
						Type.Literal('draft'),
						Type.Literal('published'),
						Type.Literal('archived'),
					]),
				}),
			);
			expect(options.status).toMatchObject({
				type: 'string',
				choices: ['draft', 'published', 'archived'],
			});
		});

		test('nullable literal union skips null variant', () => {
			const options = typeboxToYargsOptions(
				Type.Object({
					status: Type.Union([
						Type.Literal('active'),
						Type.Literal('inactive'),
						Type.Null(),
					]),
				}),
			);
			expect(options.status?.choices).toEqual(['active', 'inactive']);
		});

		test('single literal becomes single-element choices', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ mode: Type.Literal('readonly') }),
			);
			expect(options.mode).toMatchObject({
				type: 'string',
				choices: ['readonly'],
			});
		});

		test('string enum becomes choices', () => {
			enum Status {
				Draft = 'draft',
				Published = 'published',
			}
			const options = typeboxToYargsOptions(
				Type.Object({ status: Type.Enum(Status) }),
			);
			expect(options.status?.choices).toEqual(['draft', 'published']);
			expect(options.status?.type).toBe('string');
		});

		test('numeric enum becomes number choices', () => {
			enum Priority {
				Low = 0,
				Medium = 1,
				High = 2,
			}
			const options = typeboxToYargsOptions(
				Type.Object({ priority: Type.Enum(Priority) }),
			);
			expect(options.priority?.choices).toEqual([0, 1, 2]);
			expect(options.priority?.type).toBe('number');
		});

		test('union with non-literal variants has no choices', () => {
			const options = typeboxToYargsOptions(
				Type.Object({
					value: Type.Union([Type.String(), Type.Number()]),
				}),
			);
			expect(options.value?.choices).toBeUndefined();
		});
	});

	describe('metadata propagation', () => {
		test('passes through description', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ title: Type.String({ description: 'The page title' }) }),
			);
			expect(options.title?.description).toBe('The page title');
		});

		test('description is undefined when not provided', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ title: Type.String() }),
			);
			expect(options.title?.description).toBeUndefined();
		});

		test('passes through default value', () => {
			const options = typeboxToYargsOptions(
				Type.Object({ count: Type.Optional(Type.Number({ default: 10 })) }),
			);
			expect(options.count?.default).toBe(10);
			expect(options.count?.demandOption).toBe(false);
		});
	});

	describe('edge cases', () => {
		test('non-object schema returns empty options', () => {
			expect(typeboxToYargsOptions({ type: 'string' })).toEqual({});
		});

		test('empty object schema returns empty options', () => {
			expect(typeboxToYargsOptions(Type.Object({}))).toEqual({});
		});

		test('mixed required and optional fields', () => {
			const options = typeboxToYargsOptions(
				Type.Object({
					title: Type.String(),
					count: Type.Number(),
					published: Type.Optional(Type.Boolean()),
				}),
			);
			expect(Object.keys(options)).toHaveLength(3);
			expect(options.title?.demandOption).toBe(true);
			expect(options.count?.demandOption).toBe(true);
			expect(options.published?.demandOption).toBe(false);
		});
	});
});
