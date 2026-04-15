# Document Content (Per-Row Y.Docs)

## When to Read This

Read when working with `.withDocument()` tables, timeline-backed document handles, editor bindings, or batching content mutations.

## Document Content (Per-Row Y.Docs)

Tables with `.withDocument()` create a content Y.Doc per row. Content is stored using a **timeline model**: a `Y.Array('timeline')` inside the Y.Doc, where each entry is a typed `Y.Map` supporting text, richtext, and sheet modes.

### Reading and Writing Content

Use `handle.read()`/`handle.write()` on the document handle:

```typescript
const handle = await documents.open(fileId);

// Read content (timeline-backed)
const text = handle.read();

// Write content (timeline-backed)
handle.write('hello');

// Editor binding — Y.Text (converts from other modes if needed)
const ytext = handle.asText();

// Richtext editor binding — Y.XmlFragment (converts if needed)
const fragment = handle.asRichText();

// Spreadsheet binding — SheetBinding (converts if needed)
const { columns, rows } = handle.asSheet();

// Current content mode
handle.mode; // 'text' | 'richtext' | 'sheet' | undefined

// Advanced timeline operations
const tl = handle.timeline;
```

For filesystem operations, `fs.content.read(fileId)` and `fs.content.write(fileId, data)` open the handle and delegate to these methods internally.

### Batching Mutations

Use `handle.batch()` to group multiple mutations into a single Yjs transaction:

```typescript
handle.batch(() => {
  handle.write('hello');
  // ...other mutations
});
```

**Do NOT call `handle.ydoc.transact()` directly.** Use `handle.batch()` instead.

### Anti-Patterns

**Do not access `handle.ydoc` for content operations:**

```typescript
// ❌ BAD: bypasses timeline abstraction
const ytext = handle.ydoc.getText('content');
handle.ydoc.transact(() => { ... });

// ✅ GOOD: use handle methods
const ytext = handle.asText();
const fragment = handle.asRichText();
handle.batch(() => { ... });
```

`handle.ydoc` is an **escape hatch** for document extensions (persistence, sync providers) and tests. App code should never need it.
