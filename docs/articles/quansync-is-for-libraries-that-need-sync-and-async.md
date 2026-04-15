# Quansync Is for Libraries That Need Sync and Async

Always async is a good default for apps. It is not a universal win for libraries. The moment a low-level helper turns async, that requirement spreads upward through every caller, even when the actual work is usually local and synchronous. `quansync` exists for the narrower case where both sync and async callers are legitimate and you do not want to maintain the same algorithm twice.

This pattern comes from Anthony Fu's article [Async, Sync, in Between](https://antfu.me/posts/async-sync-in-between), which is worth reading before you decide whether the extra abstraction is justified in your own code.

You can think of it as a third color. Normal sync code is one color. `async` code is another. A quansync function can collapse into either one at the call site.

```typescript
import fs from "node:fs";
import { quansync } from "quansync";

const readFile = quansync({
  sync: (path: string) => fs.readFileSync(path, "utf8"),
  async: (path: string) => fs.promises.readFile(path, "utf8"),
});

const readJSON = quansync(function* (path: string) {
  const content = yield* readFile(path);
  return JSON.parse(content);
});

const a = readJSON.sync("./package.json");
const b = await readJSON.async("./package.json");
const c = await readJSON("./package.json");
```

The important part is not the syntax. The important part is that `readJSON` only has one algorithm. The branching happens at the leaves, where file I/O actually differs.

## This is what it saves you from

Without `quansync`, libraries that want both modes usually end up with two copies of the same traversal logic:

```typescript
function readJSONSync(path: string) {
  const content = fs.readFileSync(path, "utf8");
  return JSON.parse(content);
}

async function readJSON(path: string) {
  const content = await fs.promises.readFile(path, "utf8");
  return JSON.parse(content);
}
```

That example is tiny, so duplication does not look expensive yet. It gets ugly when the shared logic is 40 lines of branching, plugin hooks, fallback resolution, or recursive traversal. Then every bug fix needs to land twice.

## Markdown pipelines are the cleanest example

A markdown compiler is often synchronous by nature. Parse markdown, walk an AST, render HTML. That is all easy to keep sync until plugins show up.

```typescript
interface Plugin {
  preprocess?: (markdown: string) => string | Promise<string>;
  transform?: (ast: Ast) => Ast | Promise<Ast>;
  postprocess?: (html: string) => string | Promise<string>;
}
```

Now you have a real problem. Most plugins are sync. Some are not. Syntax highlighting might need to load a grammar or theme. A remote embed plugin might need to fetch metadata. If you make the whole pipeline `async`, every user pays the `Promise` tax even when all installed plugins are synchronous.

With `quansync`, the pipeline can stay single-source:

```typescript
import { quansync } from "quansync";

const runHook = quansync({
  sync: <T>(hook: ((value: T) => T) | undefined, value: T) =>
    hook ? hook(value) : value,
  async: async <T>(
    hook: ((value: T) => T | Promise<T>) | undefined,
    value: T,
  ) => (hook ? await hook(value) : value),
});

const markdownToHtml = quansync(function* (
  markdown: string,
  plugins: Plugin[],
) {
  for (const plugin of plugins) {
    markdown = yield* runHook(plugin.preprocess, markdown);
  }

  let ast = parse(markdown);

  for (const plugin of plugins) {
    ast = yield* runHook(plugin.transform, ast);
  }

  let html = render(ast);

  for (const plugin of plugins) {
    html = yield* runHook(plugin.postprocess, html);
  }

  return html;
});
```

The benefit is not just fewer lines. The benefit is that your algorithm reads once, top to bottom, and the caller chooses the mode:

```typescript
const html1 = markdownToHtml.sync(source, [headingPlugin(), emojiPlugin()]);
const html2 = await markdownToHtml.async(source, [shikiPlugin()]);
```

That is the exact kind of code `quansync` is good at: one traversal, optional async hooks, two legitimate entrypoints.

## File-based config loading hits the same problem

Config resolution is another strong fit. The algorithm is usually the same in both modes:

1. Find the nearest config file.
2. Read it.
3. Parse it.
4. Follow `extends`.
5. Merge defaults.

Only the file-system operations differ. The control flow does not.

```typescript
import fs from "node:fs";
import path from "node:path";
import { quansync } from "quansync";

const exists = quansync({
  sync: (filepath: string) => fs.existsSync(filepath),
  async: async (filepath: string) => {
    try {
      await fs.promises.access(filepath);
      return true;
    } catch {
      return false;
    }
  },
});

const readFile = quansync({
  sync: (filepath: string) => fs.readFileSync(filepath, "utf8"),
  async: (filepath: string) => fs.promises.readFile(filepath, "utf8"),
});

const loadConfig = quansync(function* (startDir: string) {
  let dir = startDir;

  while (true) {
    const filepath = path.join(dir, "mytool.config.json");
    if (yield* exists(filepath)) {
      const content = yield* readFile(filepath);
      const config = JSON.parse(content) as {
        extends?: string;
        rules?: Record<string, string>;
      };

      if (!config.extends) {
        return config;
      }

      const parent = yield* loadConfig(path.dirname(config.extends));
      return {
        ...parent,
        ...config,
        rules: {
          ...parent.rules,
          ...config.rules,
        },
      };
    }

    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      return {};
    }
    dir = parentDir;
  }
});
```

Now a build tool can expose both:

```typescript
const config1 = loadConfig.sync(process.cwd());
const config2 = await loadConfig.async(process.cwd());
```

That is much better than hand-maintaining `loadConfigSync()` and `loadConfig()` with the same directory walk, the same merge rules, and the same recursion.

## Always async is still the right default most of the time

This is where people overcorrect. `quansync` is not a reason to stop writing normal async code.

If your code is naturally network-bound, request-scoped, or UI-driven, just use `async`:

```typescript
const session = await authClient.getSession();
const profile = await api.users.getProfile(session.user.id);
```

There is no real upside in making that quansync. Nobody wants a synchronous version of remote auth or database access. The cost is real, the complexity is real, and the sync path would be fake anyway.

## The rule is simple

Reach for `quansync` when all of these are true:

- The core algorithm is the same in sync and async modes.
- The mode difference lives at the leaves, usually I/O or plugin hooks.
- Both sync and async consumers are real, not hypothetical.
- Duplicating the logic would be annoying enough to matter.

If those conditions are not true, use plain `async` and move on.

`quansync` does not solve the coloring problem. It gives you a controlled place to contain it. That is enough to make some library APIs much cleaner.
