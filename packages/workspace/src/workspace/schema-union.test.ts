/**
 * createUnionSchema Tests
 *
 * Verifies runtime and JSON Schema behavior for combined standard schemas.
 * The suite ensures union validation chooses the correct matching schema and rejects unsupported async validators.
 *
 * Key behaviors:
 * - Validation succeeds on the first matching schema and fails when none match.
 * - Generated input/output JSON Schema uses `oneOf` consistently.
 */

import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import type { CombinedStandardSchema } from '../shared/standard-schema.js';
import { createUnionSchema } from './schema-union.js';

describe('createUnionSchema', () => {
	test('validates against first matching schema', () => {
		const v1 = type({ id: 'string', title: 'string' });
		const v2 = type({ id: 'string', title: 'string', views: 'number' });

		const union = createUnionSchema([v1, v2]);
		const result = union['~standard'].validate({ id: '1', title: 'Hello' });

		expect(result).not.toHaveProperty('issues');
		if (!result.issues) {
			expect(result.value).toEqual({ id: '1', title: 'Hello' });
		}
	});

	test('validates against second schema when first fails', () => {
		const v1 = type({ id: 'string', title: 'string' });
		const v2 = type({ id: 'string', title: 'string', views: 'number' });

		const union = createUnionSchema([v1, v2]);
		const result = union['~standard'].validate({
			id: '1',
			title: 'Hello',
			views: 42,
		});

		expect(result).not.toHaveProperty('issues');
	});

	test('returns validation issues when no schema matches', () => {
		const v1 = type({ id: 'string', title: 'string' });

		const union = createUnionSchema([v1]);
		const result = union['~standard'].validate({ id: 123 }); // id should be string

		expect(result.issues?.length).toBeGreaterThan(0);
	});

	test('throws when schema validation is async', () => {
		const asyncSchema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => Promise.resolve({ value: {} }),
				jsonSchema: {
					input: () => ({}),
					output: () => ({}),
				},
			},
		} satisfies CombinedStandardSchema;

		const union = createUnionSchema([asyncSchema]);

		expect(() => union['~standard'].validate({})).toThrow(
			'Schema validation must be synchronous',
		);
	});

	test('produces JSON Schema with oneOf for single schema', () => {
		const v1 = type({ id: 'string', title: 'string' });

		const union = createUnionSchema([v1]);
		const jsonSchema = union['~standard'].jsonSchema.input({
			target: 'draft-2020-12',
		});

		expect(jsonSchema).toHaveProperty('oneOf');
		expect((jsonSchema as { oneOf: unknown[] }).oneOf).toHaveLength(1);

		const first = (jsonSchema as { oneOf: Record<string, unknown>[] }).oneOf[0];
		expect(first).toHaveProperty('type', 'object');
		expect(first).toHaveProperty('properties');
	});

	test('produces JSON Schema with oneOf for multiple schemas', () => {
		const v1 = type({ id: 'string', title: 'string' });
		const v2 = type({ id: 'string', title: 'string', views: 'number' });

		const union = createUnionSchema([v1, v2]);
		const jsonSchema = union['~standard'].jsonSchema.input({
			target: 'draft-2020-12',
		});

		expect(jsonSchema).toHaveProperty('oneOf');
		const oneOf = jsonSchema.oneOf;
		expect(oneOf).toHaveLength(2);

		// Both should be object schemas
		for (const schema of oneOf) {
			expect(schema).toHaveProperty('type', 'object');
		}

		// Second schema should have 'views' property
		const secondProps = (oneOf[1] as { properties: Record<string, unknown> })
			.properties;
		expect(secondProps).toHaveProperty('views');
	});

	test('output JSON Schema also uses oneOf', () => {
		const v1 = type({ id: 'string' });
		const v2 = type({ id: 'string', name: 'string' });

		const union = createUnionSchema([v1, v2]);
		const outputSchema = union['~standard'].jsonSchema.output({
			target: 'draft-2020-12',
		});

		expect(outputSchema).toHaveProperty('oneOf');
		expect((outputSchema as { oneOf: unknown[] }).oneOf).toHaveLength(2);
	});
});
