/**
 * Standard Schema union validation utilities.
 *
 * Creates a union schema that validates against any of the provided schemas.
 * Works with any Standard Schema v1 compliant library (arktype, zod, valibot, typebox).
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CombinedStandardSchema } from '../shared/standard-schema.js';

/**
 * Creates a Standard Schema that validates against a union of schemas.
 *
 * Tries each schema in order until one passes validation.
 * If none pass, returns an issue indicating no schema matched.
 * Produces JSON Schema via `oneOf` from all member schemas.
 *
 * Note: Only synchronous schemas are supported. Async schemas will throw.
 *
 * @example
 * ```typescript
 * import { type } from 'arktype';
 *
 * const v1 = type({ id: 'string', title: 'string' });
 * const v2 = type({ id: 'string', title: 'string', views: 'number' });
 *
 * const union = createUnionSchema([v1, v2]);
 * const result = union['~standard'].validate({ id: '1', title: 'Hello' });
 * // result.value is { id: '1', title: 'Hello' }
 *
 * // JSON Schema output
 * const jsonSchema = union['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
 * // { oneOf: [v1JsonSchema, v2JsonSchema] }
 * ```
 */
export function createUnionSchema<
	const TSchemas extends readonly CombinedStandardSchema[],
>(schemas: TSchemas) {
	return {
		'~standard': {
			version: 1,
			vendor: 'epicenter',
			validate: (value) => {
				const allIssues: StandardSchemaV1.Issue[] = [];

				for (const schema of schemas) {
					const result = schema['~standard'].validate(value);
					if (result instanceof Promise) {
						throw new TypeError('Schema validation must be synchronous');
					}

					// If validation passes, return the result
					if (!result.issues) {
						return result;
					}

					// Collect issues for error reporting
					allIssues.push(...result.issues);
				}

				// No schema matched - return combined issues
				return {
					issues: [
						{
							message: `Value did not match any schema version. Tried ${schemas.length} version(s).`,
							path: [],
						},
						...allIssues.slice(0, 5), // Limit to first 5 issues to avoid noise
					],
				};
			},
			jsonSchema: {
				input: (options) => ({
					oneOf: schemas.map((s) => s['~standard'].jsonSchema.input(options)),
				}),
				output: (options) => ({
					oneOf: schemas.map((s) => s['~standard'].jsonSchema.output(options)),
				}),
			},
		},
	} as const satisfies CombinedStandardSchema<
		StandardSchemaV1.InferInput<TSchemas[number]>,
		StandardSchemaV1.InferOutput<TSchemas[number]>
	>;
}
