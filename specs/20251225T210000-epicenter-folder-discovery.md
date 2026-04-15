> **Status: Superseded** by the centralized workspace model in `20260313T063000-workspace-architecture-decisions.md`. Workspaces now live under `~/.epicenter/workspaces/`, not scattered per-project.

# .epicenter Folder Discovery

## Core Concept

**One rule**: Walk up from `cwd()` until you find `.epicenter/`. Its parent directory is `projectDir`.

```
projectDir = parent of .epicenter/
```

**Breaking change**: This replaces `epicenter.config.ts`. Workspaces are now loaded dynamically from `.epicenter/workspaces/*.workspace.ts`.

## Directory Structure

```
~/projects/blog/           <- projectDir (parent of .epicenter/)
├── .epicenter/
│   ├── workspaces/
│   │   ├── pages.workspace.ts
│   │   └── auth.workspace.ts
│   └── providers/
│       ├── persistence/
│       │   └── pages.yjs
│       └── sqlite/
│           └── pages.db
├── vault/
│   └── posts/
└── notes/
```

**User can run from anywhere inside the project:**

```bash
cd ~/projects/blog/vault/posts
epicenter pages list
# Walks up: /posts -> /vault -> /blog -> finds .epicenter/ -> projectDir = /blog
```

## API Changes

### createClient()

```typescript
// Auto-discover: walks up from cwd(), loads workspaces from .epicenter/workspaces/
const client = await createClient();

// Explicit projectDir: validates .epicenter/ exists, throws if not
const client = await createClient({ projectDir: '/path/to/project' });

// Explicit workspaces (for tests, programmatic use): skips discovery
const client = await createClient(workspaces);
const client = await createClient(workspaces, {
	projectDir: '/path/to/project',
});
```

**Behavior:**

| Call                                       | Discovery                                   | Workspace Loading                           |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------- |
| `createClient()`                           | Walk up from cwd()                          | Glob `.epicenter/workspaces/*.workspace.ts` |
| `createClient({ projectDir })`             | Validate `.epicenter/` exists in projectDir | Glob `.epicenter/workspaces/*.workspace.ts` |
| `createClient(workspaces)`                 | Walk up from cwd()                          | Use provided workspaces                     |
| `createClient(workspaces, { projectDir })` | Use provided projectDir                     | Use provided workspaces                     |

### Removed

- `epicenter.config.ts` - no longer needed
- `epicenter init` command - not needed

## Implementation Plan

- [ ] Add `findProjectDir()` - walk up to find `.epicenter/`
- [ ] Add `loadWorkspaces(projectDir)` - glob and import `*.workspace.ts` files
- [ ] Update `createClient()` overloads:
  - No args: auto-discover projectDir, auto-load workspaces
  - Options only: validate projectDir, auto-load workspaces
  - Workspaces only: auto-discover projectDir, use provided workspaces
  - Both: use provided projectDir and workspaces
- [ ] Update CLI to use new createClient() (no manual config loading)
- [ ] Remove `loadEpicenterConfig()` and related code
- [ ] Update examples to use `.epicenter/workspaces/` structure

---

## Discovery Algorithm

```typescript
import { join, dirname, parse, resolve } from 'node:path';

/**
 * Find projectDir by walking up from startDir until .epicenter/ is found.
 * Returns the parent directory of .epicenter/ (not .epicenter/ itself).
 */
async function findProjectDir(
	startDir: string = process.cwd(),
): Promise<string | null> {
	let current = resolve(startDir);
	const root = parse(current).root;

	while (current !== root) {
		const epicenterPath = join(current, '.epicenter');
		const file = Bun.file(join(epicenterPath, '.gitkeep')); // or any marker

		// Check if directory exists by trying to access it
		try {
			const glob = new Glob('*');
			// If we can scan it, it exists (even if empty, the scan succeeds)
			for await (const _ of glob.scan({ cwd: epicenterPath })) {
				return current; // Found it, return parent
			}
			// Empty directory - still valid
			return current;
		} catch {
			// Directory doesn't exist, keep walking up
		}

		current = dirname(current);
	}

	return null;
}
```

## Workspace Loading

```typescript
import { Glob } from 'bun';
import { join } from 'node:path';

/**
 * Load all workspace configs from .epicenter/workspaces/*.workspace.ts
 */
async function loadWorkspaces(
	projectDir: string,
): Promise<AnyWorkspaceConfig[]> {
	const workspacesDir = join(projectDir, '.epicenter', 'workspaces');
	const glob = new Glob('*.workspace.ts');

	const workspaces: AnyWorkspaceConfig[] = [];

	for await (const file of glob.scan({ cwd: workspacesDir, absolute: true })) {
		const module = await import(file);
		const workspace = module.default || module;

		if (!isWorkspaceConfig(workspace)) {
			throw new Error(
				`Invalid workspace file: ${file}\n` +
					`Expected default export to be a workspace config (from defineWorkspace())`,
			);
		}

		workspaces.push(workspace);
	}

	if (workspaces.length === 0) {
		throw new Error(
			`No workspace files found in ${workspacesDir}\n` +
				`Expected files matching *.workspace.ts`,
		);
	}

	return workspaces;
}

function isWorkspaceConfig(value: unknown): value is AnyWorkspaceConfig {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		'tables' in value &&
		typeof (value as any).id === 'string'
	);
}
```

## Updated createClient Signature

```typescript
// Overload 1: No args - auto-discover everything
export async function createClient(): Promise<EpicenterClient<any>>;

// Overload 2: Options only - auto-load workspaces from projectDir
export async function createClient(
  options: CreateClientOptions
): Promise<EpicenterClient<any>>;

// Overload 3: Single workspace - auto-discover projectDir
export async function createClient<...>(
  workspace: WorkspaceConfig<...>,
  options?: CreateClientOptions,
): Promise<WorkspaceClient<TExports>>;

// Overload 4: Multiple workspaces - auto-discover projectDir
export async function createClient<...>(
  workspaces: TConfigs,
  options?: CreateClientOptions,
): Promise<EpicenterClient<TConfigs>>;
```

## CLI Update

```typescript
// bin.ts - simplified
async function main() {
	await using client = await createClient();
	await createCLI(client).run(hideBin(process.argv));
}
```

The CLI no longer needs `loadEpicenterConfig()` - `createClient()` handles everything.

## Tauri App Consideration

A Tauri app knows where its data lives:

```typescript
// Tauri app - explicit path since it knows where .epicenter/ lives
const appData = await appDataDir(); // ~/Library/Application Support/MyApp/
const client = await createClient({ projectDir: appData });
```

The app doesn't need root folder access - it just needs access to its own data directory where `.epicenter/` lives.

## Error Messages

```
// No .epicenter/ found
Error: No .epicenter folder found.
Walked up from: /Users/me/projects/blog/vault/posts
To create a project: mkdir .epicenter/workspaces

// .epicenter/ exists but no workspaces
Error: No workspace files found in /Users/me/projects/blog/.epicenter/workspaces
Expected files matching *.workspace.ts

// Invalid workspace file
Error: Invalid workspace file: /path/to/.epicenter/workspaces/broken.workspace.ts
Expected default export to be a workspace config (from defineWorkspace())

// Explicit projectDir but no .epicenter/
Error: No .epicenter folder found in /custom/path
Expected directory: /custom/path/.epicenter
```

---

## Completed: createDiagnosticsManager Async Fix

Fixed bug where `createDiagnosticsManager` used sync wrapper but called async Bun APIs:

```typescript
// Before (broken)
const content = Bun.file(path).text(); // Returns Promise!
JSON.parse(content); // JSON.parse(Promise) = broken

// After (fixed)
export async function createDiagnosticsManager(...): Promise<DiagnosticsManager> {
  if (!(await file.exists())) return {};
  const content = await file.text();
  return JSON.parse(content);
}
```

Files changed:

- `packages/epicenter/src/indexes/markdown/diagnostics-manager.ts`
- `packages/epicenter/src/indexes/markdown/markdown-index.ts`
