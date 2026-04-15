import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from '@standard-schema/spec';
import { Ok, trySync } from 'wellcrafted/result';

/**
 * Epicenter-specific Standard Schema extensions.
 *
 * Upstream spec types (`StandardSchemaV1`, `StandardJSONSchemaV1`, etc.)
 * should be imported directly from `@standard-schema/spec`.
 *
 * @see https://standardschema.dev
 * @see https://github.com/standard-schema/standard-schema
 */

// ###############################
// ###   Epicenter Extensions  ###
// ###############################

/**
 * Schema type that implements both StandardSchema (validation) and StandardJSONSchema (conversion).
 *
 * Use this as a constraint when you need:
 * 1. Runtime validation via `~standard.validate()`
 * 2. JSON Schema generation via `~standard.jsonSchema.input()`
 *
 * ArkType, Zod (v4.2+), and Valibot (with adapter) all implement both specs.
 *
 * @example
 * ```typescript
 * // ArkType
 * import { type } from 'arktype';
 * type('string') satisfies CombinedStandardSchema; // ✅
 *
 * // Zod (v4.2+)
 * import * as z from 'zod';
 * z.string() satisfies CombinedStandardSchema; // ✅
 * ```
 */
export type CombinedStandardSchema<TInput = unknown, TOutput = TInput> = {
	'~standard': StandardSchemaV1.Props<TInput, TOutput> &
		StandardJSONSchemaV1.Props<TInput, TOutput>;
};

/**
 * Arktype fallback handlers for JSON Schema conversion.
 *
 * Arktype represents optional properties as `T | undefined` internally.
 * JSON Schema doesn't have an `undefined` type — it handles optionality via
 * the `required` array. The `unit` handler strips `undefined` from unions
 * so the conversion succeeds.
 *
 * Non-undefined fallbacks (morphs, predicates, proto types, etc.) are logged
 * with console.warn and preserve the partial schema so other fields aren't lost.
 *
 * @see https://arktype.io/docs/json-schema - arktype's toJsonSchema docs
 */
const ARKTYPE_FALLBACK = {
	unit: (ctx: {
		code: 'unit';
		unit: unknown;
		base: Record<string, unknown>;
	}): Record<string, unknown> => {
		if (ctx.unit === undefined) return {};
		console.warn(
			`[arktype→JSON Schema] Unit type "${String(ctx.unit)}" (${typeof ctx.unit}) cannot be converted. ` +
				`Using base schema as fallback.`,
		);
		return ctx.base;
	},
	default: (ctx: {
		code: string;
		base: Record<string, unknown>;
	}): Record<string, unknown> => {
		console.warn(
			`[arktype→JSON Schema] Fallback triggered for code "${ctx.code}". ` +
				`Base schema: ${JSON.stringify(ctx.base)}`,
		);
		return ctx.base;
	},
};

/**
 * Safely convert a Standard JSON Schema to a plain JSON Schema object.
 *
 * Uses the Standard JSON Schema interface (`~standard.jsonSchema.input`) which
 * is vendor-agnostic. For arktype, fallback handlers are passed via `libraryOptions`
 * to handle unconvertible types gracefully.
 *
 * ## Two-layer safety net
 *
 * 1. **Fallback handlers (arktype-specific)**: Intercept conversion issues per-node
 *    in the schema tree, allowing partial success. If a schema has 10 fields
 *    and only 1 has an unconvertible type, the other 9 are preserved.
 *
 * 2. **Outer catch**: Last-resort failsafe for truly catastrophic failures.
 *    Returns `{}` (permissive empty schema) if everything else fails.
 *
 * @see https://standardschema.dev/json-schema - Standard JSON Schema spec
 * @see https://arktype.io/docs/json-schema - arktype's toJsonSchema docs
 *
 * @param schema - Standard JSON Schema to convert
 * @returns JSON Schema object, or permissive `{}` on error
 */
export function standardSchemaToJsonSchema(
	schema: StandardJSONSchemaV1,
): Record<string, unknown> {
	const { data } = trySync({
		try: () =>
			schema['~standard'].jsonSchema.input({
				target: 'draft-2020-12',
				libraryOptions: {
					fallback: ARKTYPE_FALLBACK,
				},
			}),
		catch: (e) => {
			console.warn(
				'[standardSchemaToJsonSchema] Conversion failure, using permissive fallback:',
				e,
			);
			return Ok({});
		},
	});
	return data;
}
