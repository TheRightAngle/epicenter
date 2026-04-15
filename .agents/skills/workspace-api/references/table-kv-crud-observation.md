# Table and KV CRUD + Observation

## When to Read This

Read when implementing table/KV read-write operations, observation callbacks, or reactive integration guidance.

## Reading & Observing Data

### Table CRUD

```typescript
table.get(id)          // { status: 'valid', row } | { status: 'not_found' } | { status: 'invalid' }
table.getAllValid()     // T[] — all rows that pass schema validation
table.set(row)         // upsert full row (replaces entire row)
table.update(id, partial) // merge partial fields into existing row
table.delete(id)       // remove row
table.has(id)          // boolean
table.count()          // number
```

### KV CRUD

```typescript
kv.get('key')          // returns value (or default from defineKv)
kv.set('key', value)   // set value
```

### Observation

Tables and KV stores support change observation for reactive updates:

```typescript
// Table — callback receives changed row IDs per Y.Transaction
const unsub = tables.posts.observe((changedIds) => {
	for (const id of changedIds) {
		const result = tables.posts.get(id);
		// ...
	}
});

// KV — per-key observation
const unsub = kv.observe('theme', (change) => {
	if (change.type === 'set') { /* change.value */ }
	if (change.type === 'delete') { /* fell back to default */ }
});
```

**In Svelte apps**, prefer `fromTable`/`fromKv` from `@epicenter/svelte` instead of raw observers. See the `svelte` skill for the reactive table state pattern.
