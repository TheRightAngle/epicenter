# Why batch() Instead of setMany()/deleteMany()

When designing the TableHelper API, I faced a common API design question: how should users perform multiple operations?

## The Options I Considered

### Option 1: Separate "Many" Methods

```typescript
// Prisma-style
table.set(row);
table.setMany([row1, row2, row3]);
table.delete(id);
table.deleteMany([id1, id2, id3]);
```

This is what Prisma does. Clear, explicit, familiar. But it has problems:

1. **Different return types**: `delete()` returns `void`, but `deleteMany()` might need a different return shape with arrays of what succeeded/failed. The types can diverge.

2. **No composition**: What if you want to set two rows AND delete one atomically? You'd need a third method or accept non-atomic behavior.

3. **Hidden semantics**: In my case, `setMany` was just a loop. No batching, no transaction. It was syntactic sugar that obscured what was actually happening.

### Option 2: Function Overloads

```typescript
// Drizzle/Kysely-style
table.set(row);           // single
table.set([row1, row2]);  // array

table.delete(id);
table.delete([id1, id2]);
```

Cleaner API surface. But the return type problem gets worse - you need conditional return types:

```typescript
delete<T extends string | readonly string[]>(
  id: T
): T extends string ? void : void;
```

TypeScript can handle this, but it's gnarly for consumers. And you still can't mix operations.

### Option 3: Explicit batch() API (What I Chose)

```typescript
// Single operations - simple, clear
table.set(row);
table.delete(id);

// Multiple operations - explicit transaction
table.batch((tx) => {
  tx.set(row1);
  tx.set(row2);
  tx.delete(oldId);
});
```

## Why batch() Wins

### 1. Honest About What It Does

The `batch()` API wraps operations in a Y.js transaction. This isn't just syntax - it has real semantics:

- **Single observer notification**: UI updates once, not N times
- **Single undo/redo step**: Better UX for undo
- **Atomic application**: All changes apply together

When you see `batch()`, you know something meaningful is happening. When you see `setMany()`, you don't know if it's batched or just a loop.

### 2. Composable

With `batch()`, you can mix any operations:

```typescript
table.batch((tx) => {
  tx.set(newRow);
  tx.set(updatedRow);
  tx.delete(obsoleteId);
});
```

With separate methods, you'd need `setAndDeleteMany()` or accept that your "batch" operations aren't actually atomic.

### 3. Matches the Underlying Model

Y.js has `doc.transact()`. Our `batch()` is a thin wrapper that gives you transaction semantics for a single table. The abstraction matches the underlying reality.

For cross-table operations, you can still use the raw Y.js API:

```typescript
client.ydoc.transact(() => {
  client.tables.posts.set(post);
  client.tables.users.set(user);
});
```

### 4. Simpler Types

No conditional return types. No divergent "Many" result types. `batch()` returns `void` because inside a transaction, you typically don't need individual operation results - you care about the batch succeeding or failing as a whole.

## The Tradeoff

The downside: slightly more verbose for simple cases.

```typescript
// Before
table.setMany([row1, row2, row3]);

// After
table.batch((tx) => {
  tx.set(row1);
  tx.set(row2);
  tx.set(row3);
});
```

But I'd argue the verbosity is appropriate. You're doing something meaningful (a transaction), and the code reflects that. Three lines isn't much, and you could always use a loop inside the batch if you have an array:

```typescript
table.batch((tx) => {
  for (const row of rows) tx.set(row);
});
```

## Comparison to Other APIs

| API | Pattern | Notes |
|-----|---------|-------|
| Prisma | `setMany`/`deleteMany` | Separate methods, different return types |
| Drizzle | Array overloads | Same method accepts single or array |
| Y.js | `doc.transact()` | Explicit transaction wrapper |
| **Epicenter** | `batch()` | Explicit transaction, composable operations |

We landed closer to Y.js's model because that's what we're wrapping. The API is honest about its semantics rather than hiding them behind convenience methods.

## When to Use batch()

Use `batch()` when you want:
- Multiple operations to fire a single observer notification
- A single undo/redo step for the user
- Atomic application of related changes

For single operations, just use `set()` or `delete()` directly. Y.js will auto-batch operations in the same microtask anyway, but `batch()` makes the intent explicit.
