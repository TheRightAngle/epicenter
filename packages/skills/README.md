# @epicenter/skills

`@epicenter/skills` gives Epicenter apps a shared workspace for skills and references. It exists so prompts, conventions, and supporting docs can live in the same CRDT-backed system as everything else instead of being trapped in loose markdown files. Apps like Opensidian read from this workspace to assemble layered system prompts, while the dedicated skills app edits and syncs the same data.

## Quick usage

Opensidian wires it up like this in `apps/opensidian/src/lib/client.ts`:

```typescript
import { createSkillsWorkspace } from '@epicenter/skills';
import { indexeddbPersistence } from '@epicenter/workspace/extensions/persistence/indexeddb';

export const skillsWorkspace = createSkillsWorkspace().withExtension(
	'persistence',
	indexeddbPersistence,
);
```

The workspace ships with read actions for progressive disclosure. This example comes from `packages/skills/src/workspace.ts`:

```typescript
const skills = ws.actions.listSkills();
const result = await ws.actions.getSkill({ id: 'abc123' });
if (result) systemPrompt += result.instructions;
```

That split is deliberate. You can browse the catalog cheaply, load one skill when you need it, or fetch the full skill plus references when you're building a prompt.

## Data model

The package defines two tables under the `epicenter.skills` workspace ID.

```text
skills row
  ├─ metadata columns
  └─ instructions document

references row
  ├─ skillId -> points at a skill row
  └─ content document
```

`skillsTable` stores one row per skill. Frontmatter fields like `description`, `license`, `compatibility`, `metadata`, and `allowed-tools` map to columns. The markdown body is not stored in a plain string column—it lives in a per-row Y.Doc attached as `instructions`.

`referencesTable` stores one row per file in a skill's `references/` directory. Each reference also gets its own attached Y.Doc, exposed as `content`.

That design keeps the catalog small and queryable while still letting editors collaborate on large markdown bodies with Yjs.

## API overview

### `createSkillsWorkspace()`

Creates an isomorphic workspace client with three read actions already attached:

- `listSkills()` for the cheap catalog view
- `getSkill({ id })` for one skill plus instructions
- `getSkillWithReferences({ id })` for the full skill bundle

The returned client is still a normal Epicenter workspace builder, so apps can add persistence, sync, or more actions with the usual `.withExtension()` and `.withActions()` chain.

### `skillsTable`

The table definition for skill metadata, with a document attachment for `instructions`.

### `referencesTable`

The table definition for reference metadata, with a document attachment for `content`.

### `Skill` and `Reference`

Row types inferred from the two table definitions.

### `skillsDefinition`

The prebuilt workspace definition for `epicenter.skills`. Most callers want `createSkillsWorkspace()` instead, but the definition is exported for custom embedding.

## Relationship to the monorepo

This package is the shared data model behind Epicenter's skill system.

- `packages/skills` defines the workspace, tables, and read actions.
- `apps/skills` uses it as the editor and manager UI.
- `apps/opensidian` mounts a second workspace just for global skills and reads from it during prompt assembly.
- `@epicenter/workspace` provides the CRDT tables, documents, and builder underneath it all.

There is also a `@epicenter/skills/node` subpath. That version adds disk I/O actions like `importFromDisk()` and `exportToDisk()` so skill folders on disk can round-trip into the workspace and back out again.

## Source entry point

The root export in `src/index.ts` is small on purpose:

```typescript
export { createSkillsWorkspace } from './workspace.js';
export { skillsDefinition } from './definition.js';
export { skillsTable, referencesTable } from './tables.js';
export type { Skill, Reference } from './tables.js';
```

If you only need a shared skills workspace in an app, that's enough.

## License

MIT
