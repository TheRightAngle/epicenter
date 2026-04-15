---
name: typescript
description: TypeScript code style, type co-location, naming conventions (including acronym casing), and arktype patterns. Use when the user mentions TypeScript types, naming conventions, or when writing .ts files, defining types, naming variables/functions, or organizing test files.
metadata:
  author: epicenter
  version: '2.0'
---

# TypeScript Guidelines

> **Related Skills**: See `arktype` for runtime type validation patterns. See `typebox` for TypeBox schema patterns. See `testing` for test file conventions.

## When to Apply This Skill

Use this pattern when you need to:

- Write or refactor TypeScript code with project-wide naming and style conventions.
- Choose clear control-flow/value-mapping patterns for unions and discriminated values.
- Apply baseline TypeScript defaults before loading specialized sub-topic guidance.

## References

Load these on demand based on what you're working on:

- If working with **type placement and constants organization** (`types.ts` location, co-location rules, options/IDs naming), read [references/type-organization.md](references/type-organization.md)
- If working with **factory-focused refactors** (parameter destructuring, extracting coupled `let` state into sub-factories), read [references/factory-patterns.md](references/factory-patterns.md)
- If working with **arktype + branded IDs** (optional property syntax, brand constructors, workspace table IDs), read [references/runtime-schema-patterns.md](references/runtime-schema-patterns.md)
- If working with **test writing and test file layout** (inline single-use setup, source-shadowing tests), read [references/testing-patterns.md](references/testing-patterns.md)
- If working with **advanced TS/ES features** (iterator helpers, const generic array inference), read [references/advanced-typescript-features.md](references/advanced-typescript-features.md)

---

## Core Rules

- Always use `type` instead of `interface` in TypeScript.
- **`readonly` only for arrays and maps**: Never use `readonly` on primitive properties or object properties. The modifier is shallow and provides little protection for non-collection types. Use it only where mutation is a realistic footgun:

  ```typescript
  // Good - readonly only on the array
  type Config = {
  	version: number;
  	vendor: string;
  	items: readonly string[];
  };

  // Bad - readonly everywhere is noise
  type Config = {
  	readonly version: number;
  	readonly vendor: string;
  	readonly items: readonly string[];
  };
  ```

  Exception: Match upstream library types exactly (e.g., standard-schema interfaces). See `docs/articles/readonly-is-mostly-noise.md` for rationale.

- **Acronyms in camelCase**: Treat acronyms as single words, capitalizing only the first letter:

  ```typescript
  // Correct - acronyms as words
  parseUrl();
  defineKv();
  readJson();
  customerId;
  httpClient;

  // Incorrect - all-caps acronyms
  parseURL();
  defineKV();
  readJSON();
  customerID;
  HTTPClient;
  ```

  Exception: Match existing platform APIs (e.g., `XMLHttpRequest`). See `docs/articles/acronyms-in-camelcase.md` for rationale.

- TypeScript 5.5+ automatically infers type predicates in `.filter()` callbacks. Don't add manual type assertions:

  ```typescript
  // Good - TypeScript infers the narrowed type automatically
  const filtered = items.filter((x) => x !== undefined);

  // Bad - unnecessary type predicate
  const filtered = items.filter(
  	(x): x is NonNullable<typeof x> => x !== undefined,
  );
  ```

- When moving components to new locations, always update relative imports to absolute imports (e.g., change `import Component from '../Component.svelte'` to `import Component from '$lib/components/Component.svelte'`)
- **Use `.js` extensions in relative imports**: The monorepo uses `"module": "preserve"` in tsconfig, which requires explicit file extensions. Always use `.js` (not `.ts`) in relative import paths—TypeScript resolves `.js` to the corresponding `.ts` file at compile time:

  ```typescript
  // Good — .js extension in relative imports
  import { parseSkill } from './parse.js';
  import type { Skill } from './types.js';

  // Bad — no extension (fails with module: preserve)
  import { parseSkill } from './parse';

  // Bad — .ts extension (non-standard, won't resolve correctly)
  import { parseSkill } from './parse.ts';
  ```

  This does NOT apply to package imports (`import { type } from 'arktype'`) or path aliases (`import Component from '$lib/components/Foo.svelte'`)—only bare relative paths.
- **`export { }` is only for barrel files**: Every symbol is exported directly at its declaration (`export type`, `export const`, `export function`). The `export { Foo } from './bar'` re-export syntax is reserved for `index.ts` barrel files—that's their entire job. Don't add re-exports at the bottom of implementation files "for convenience"; they go unused, leave orphaned imports, and create a false second import path.

  ```typescript
  // Good — direct export at declaration
  export type TablesHelper<T> = { ... };
  export const EncryptionKey = type({ ... });
  export function createTables(...) { ... }

  // Good — barrel re-exports in index.ts
  export { createTables } from './create-tables.js';
  export type { TablesHelper } from './types.js';

  // Bad — re-export at bottom of create-tables.ts
  export type { TablesHelper, TableDefinitions };
  ```
- When functions are only used in the return statement of a factory/creator function, use object method shorthand syntax instead of defining them separately. For example, instead of:
  ```typescript
  function myFunction() {
  	const helper = () => {
  		/* ... */
  	};
  	return { helper };
  }
  ```
  Use:
  ```typescript
  function myFunction() {
  	return {
  		helper() {
  			/* ... */
  		},
  	};
  }
  ```
- **Prefer factory functions over classes**: Use `function createX() { return { ... } }` instead of `class X { ... }`. Closures provide structural privacy—everything above the return statement is private by position, everything inside it is the public API. Classes mix `private`/`protected`/public members in arbitrary order, forcing you to scan every member and check its modifier. See `docs/articles/closures-are-better-privacy-than-keywords.md` for rationale.
- **Generic type parameters use `T` prefix + descriptive name**: Never use single letters like `S`, `D`, `K`. Always prefix with `T` and use the full name:

  ```typescript
  // Good — descriptive with T prefix
  function validate<TSchema extends StandardSchemaV1>(schema: TSchema) { ... }
  type MapOptions<TDefs extends Record<string, Definition>> = { ... };
  function get<TKey extends string & keyof TDefs>(key: TKey) { ... }

  // Bad — single letters
  function validate<S extends StandardSchemaV1>(schema: S) { ... }
  type MapOptions<D extends Record<string, Definition>> = { ... };
  function get<K extends string & keyof D>(key: K) { ... }
  ```

- **Destructure options in function signature, not the first line of the body**:

  ```typescript
  // Good — destructure in the signature
  export function createThing<T>({
  	name,
  	value,
  	onError,
  }: ThingOptions<T>) {
  	// function body starts here
  }

  // Bad — intermediate `options` parameter, destructured on first line
  export function createThing<T>(options: ThingOptions<T>) {
  	const { name, value, onError } = options;
  	// ...
  }
  ```

- **Don't annotate return types the compiler can infer**: Let TypeScript infer return types on inner/private functions. Only annotate return types on exported public API functions when the inferred type is too complex or when you need to break circular inference.

  ```typescript
  // Good — inner functions let TS infer
  function parseValue(raw: string | null) {
  	if (raw === null) return defaultValue;
  	return JSON.parse(raw);
  }

  // Bad — unnecessary return type annotation
  function parseValue(raw: string | null): SomeType {
  	if (raw === null) return defaultValue;
  	return JSON.parse(raw);
  }
  ```

## Boolean Naming: `is`/`has`/`can` Prefix

Boolean properties, variables, and parameters MUST use a predicate prefix that reads as a yes/no question:

- `is` — state or identity: `isEncrypted`, `isLoading`, `isVisible`, `isActive`
- `has` — possession or presence: `hasToken`, `hasChildren`, `hasError`
- `can` — capability or permission: `canWrite`, `canDelete`, `canUndo`

```typescript
// Good — reads as a question
type Config = {
	isEncrypted: boolean;
	isReadOnly: boolean;
	hasCustomTheme: boolean;
	canExport: boolean;
};

get isEncrypted() { return currentKey !== undefined; }
const isVisible = element.offsetParent !== null;
if (hasToken) { ... }

// Bad — ambiguous, doesn't read as yes/no
type Config = {
	encrypted: boolean;    // adjective without 'is'
	readOnly: boolean;     // could be a noun
	state: boolean;        // what state?
	mode: boolean;         // what mode?
};
```

This applies to:
- Object/type properties (`isActive: boolean`)
- Getter methods (`get isEncrypted()`)
- Local variables (`const isValid = ...`)
- Function parameters (`function toggle(isEnabled: boolean)`)
- Function return values when the function is a predicate (`function isExpired(): boolean`)

Exception: Match upstream library types exactly (e.g., `tab.pinned`, `window.focused` from APIs where the type is externally defined).

## Switch Over If/Else for Value Comparison

When multiple `if`/`else if` branches compare the same variable against string literals (or other constant values), always use a `switch` statement instead. This applies to action types, status fields, file types, strategy names, or any discriminated value.

```typescript
// Bad - if/else chain comparing the same variable
if (change.action === 'add') {
	handleAdd(change);
} else if (change.action === 'update') {
	handleUpdate(change);
} else if (change.action === 'delete') {
	handleDelete(change);
}

// Good - switch statement
switch (change.action) {
	case 'add':
		handleAdd(change);
		break;
	case 'update':
		handleUpdate(change);
		break;
	case 'delete':
		handleDelete(change);
		break;
}
```

Use fall-through for cases that share logic:

```typescript
switch (change.action) {
	case 'add':
	case 'update': {
		applyChange(change);
		break;
	}
	case 'delete': {
		removeChange(change);
		break;
	}
}
```

Use block scoping (`{ }`) when a case declares variables with `let` or `const`.

When NOT to use switch: early returns for type narrowing are fine as sequential `if` statements. If each branch returns immediately and the checks are narrowing a union type for subsequent code, keep them as `if` guards.

See `docs/articles/switch-over-if-else-for-value-comparison.md` for rationale.

## Record Lookup Over Nested Ternaries

When an expression maps a finite set of known values to outputs, use a `satisfies Record` lookup instead of nested ternaries. This is the expression-level counterpart to "Switch Over If/Else": switch handles statements with side effects, record lookup handles value mappings.

```typescript
// Bad - nested ternary
const tooltip = status === 'connected'
	? 'Connected'
	: status === 'connecting'
		? 'Connecting…'
		: 'Offline';

// Good - record lookup with exhaustive type checking
const tooltip = ({
	connected: 'Connected',
	connecting: 'Connecting…',
	offline: 'Offline',
} satisfies Record<SyncStatus, string>)[status];
```

`satisfies Record<SyncStatus, string>` gives you compile-time exhaustiveness: if `SyncStatus` gains a fourth value, TypeScript errors because the record is missing a key. Nested ternaries silently fall through to the else branch.

`as const` is unnecessary here. `satisfies` already validates the shape and value types. `as const` would narrow values to literal types (`'Connected'` instead of `string`), which adds no value when the output is just rendered or passed as a string.

When the record is used once, inline it. When it's shared or has 5+ entries, extract to a named constant.

See `docs/articles/record-lookup-over-nested-ternaries.md` for rationale.

## Silent Fallback Smell

Not all `??` expressions are safe defaults. When the fallback creates **state that other systems depend on**, the nullish coalescing hides a broken invariant.

```typescript
// Safe default — divergence doesn't matter
const timeout = options.timeout ?? 5000;

// SMELL — fallback creates divergent identity
// Two machines importing the same data silently get different IDs
const id = parsedId ?? generateId();
```

The test: **does the fallback create state that must be consistent across systems?** If yes, the `??` is masking a problem. Fix it by:

- **Self-healing**: generate the value and write it back to the source, so the fallback never fires again
- **Throwing**: make the invariant explicit—if the value should exist, its absence is an error
- **Warning**: at minimum, make the fallback visible so silent divergence doesn't go unnoticed

## Round-Trip Invariant

If you serialize and then deserialize, identity properties must survive:

```typescript
// This must hold for any entity with stable identity:
const exported = serialize(entity);
const reimported = deserialize(exported);
assert(reimported.id === entity.id);
```

If an ID doesn't survive a full cycle, every system that references it by ID is broken—document handles, foreign keys, cache entries. The round-trip test is: "If I export to disk and import on a fresh machine, does everything still match?"

When designing parse/serialize pairs, decide which fields are **identity** (must survive round-trips) vs **derived** (can be recomputed). Persist identity fields explicitly—don't rely on matching by secondary keys to recover them.
