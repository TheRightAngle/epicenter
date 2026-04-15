# Handoff: Fix Record Type Arguments in UI Components

## Summary

Three UI component files use `Record` without type arguments in snippet parameters, causing TypeScript errors. This needs to be fixed to `Record<string, unknown>`.

## Background Research

### What shadcn-svelte Actually Does

According to DeepWiki research on `huntabyte/shadcn-svelte`, their actual codebase uses `Record<string, unknown>` explicitly:

- `docs/src/lib/registry/ui/sidebar/sidebar-menu-button.svelte`: `child?: Snippet<[{ props: Record<string, unknown> }]>;`
- `docs/src/lib/components/chart-code-viewer.svelte`: `props: Record<string, unknown>`
- Similar explicit typing in `sidebar-group-action.svelte`, `sidebar-menu-sub-button.svelte`, `sidebar-group-label.svelte`

### Why Bare `Record` Is Invalid

TypeScript's `Record<K, V>` is a generic utility type that **requires** two type arguments:
- `K`: The type of the keys (usually `string`)
- `V`: The type of the values (usually `unknown` for flexible props)

Using `Record` without arguments is a TypeScript error, not a valid pattern.

### Svelte 5 Snippet Best Practices

Per Svelte 5 documentation, when typing snippet parameters that receive props:
- Use `Snippet<[{ props: Record<string, unknown> }]>` for child snippets receiving props
- The `Record<string, unknown>` type allows any object with string keys to be spread onto elements

## Files to Fix

| File | Line | Current | Fix |
|------|------|---------|-----|
| `packages/ui/src/button/button.svelte` | 72 | `tooltipProps?: Record` | `tooltipProps?: Record<string, unknown>` |
| `packages/ui/src/link/link.svelte` | 25 | `tooltipProps?: Record` | `tooltipProps?: Record<string, unknown>` |
| `packages/ui/src/sidebar/sidebar-menu-button.svelte` | 78 | `props?: Record` | `props?: Record<string, unknown>` |

## The Fix

Change each occurrence from:
```typescript
{#snippet buttonContent(tooltipProps?: Record)}
```

To:
```typescript
{#snippet buttonContent(tooltipProps?: Record<string, unknown>)}
```

## Why `Record<string, unknown>`?

- `string` keys: HTML/Svelte props are always string-keyed
- `unknown` values: Values can be strings, numbers, booleans, functions, etc.
- This matches shadcn-svelte's upstream pattern exactly

## Verification

After fixing, run:
```bash
cd apps/whispering && bun run svelte-check --tsconfig ./tsconfig.json
```

The "Generic type 'Record' requires 2 type argument(s)" errors should be resolved.

## Related Context

- These components were likely copied/forked from shadcn-svelte at some point
- The type arguments may have been accidentally omitted during copying or editing
- The fix aligns with upstream shadcn-svelte patterns
