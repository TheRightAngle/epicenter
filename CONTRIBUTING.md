# Contributing to Epicenter

Welcome! We're excited you're interested in contributing to Epicenter. This guide will help you get up and running quickly.

## Prerequisites

- **Bun**: We use Bun as our JavaScript runtime and package manager
  - Install from [bun.sh](https://bun.sh) if you don't have it
  - The repo requires Bun 1.2.19 or newer (automatically enforced)

## Getting Started

Epicenter is a monorepo containing multiple applications. The main application ready for contributions is **Whispering** (located in `apps/whispering`).

### Quick Setup

1. **Fork and clone the repository**

   [Fork the repository](https://github.com/EpicenterHQ/epicenter/fork) and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/epicenter.git
   cd epicenter
   ```

   > New to open source? Check out [How to Contribute to Open Source](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github) (free video series).

2. **Install dependencies**

   ```bash
   bun install
   ```

   > **Note**: If you see a version warning, run `bun upgrade` to update to the required version. The repository uses Bun 1.2.19 to ensure consistency across all contributors.

   > **Note**: Desktop app development requires external tools not installed by the command above. Install these manually.
   > (For example: [Rust](https://www.rust-lang.org/tools/install) and [CMake](https://cmake.org/download/))

3. **Navigate to the Whispering app**

   ```bash
   cd apps/whispering
   ```

4. **Start development**

   ```bash
   # Run both web and desktop mode
   bun dev

   # Or run just the web version
   bun dev:web
   ```

That's it! You're ready to start contributing.

## Project Structure

This is a monorepo with the following structure:

```
epicenter/
├── apps/
│   ├── whispering/     # Main transcription app (ready for contributions)
│   ├── sh/             # Local assistant (in development)
│   └── ...             # Other apps in various stages
├── packages/
│   ├── db/             # Shared database schema for our hosted services
│   ├── ui/             # Shared UI components
│   └── ...
└── ...
```

### Where to Contribute

Currently, **Whispering** (`apps/whispering`) is the most mature application and the best place to start contributing. Check the [Whispering README](apps/whispering/README.md) for specific details about that application.

## Development Workflow

1. **Create a branch** for your feature or fix

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** following our coding standards (see below)

3. **Test your changes** thoroughly

   ```bash
   # Run tests if available
   bun test
   ```

4. **Commit using conventional commits**

   ```bash
   git commit -m "feat(whispering): add new feature"
   ```

5. **Push and create a pull request**

   ```bash
   git push origin feat/your-feature-name
   ```

   Create a PR to merge your fork's branch into `EpicenterHQ/epicenter:main`:
   Go to [EpicenterHQ/epicenter](https://github.com/EpicenterHQ/epicenter) — GitHub usually shows a "Compare & pull request" banner for recent pushes.

### Changelog Entries

Every PR with a `feat:` or `fix:` prefix should include a `## Changelog` section in the PR description. These entries get aggregated into GitHub Releases automatically.

Write one line per user-visible change, in imperative mood, for end users—not developers. The person who wrote the code is always best positioned to describe what it does.

**Good entries:**

- Add Bun sidecar for local workspace sync
- Fix audio clipping when switching transcription providers mid-session

**Bad entries:**

- refactor(services): flatten isomorphic/ to services root
- Update deps

Internal-only PRs (`chore:`, `refactor:`, `docs:`) should omit the `## Changelog` section entirely. They still get released but won't appear in the changelog.

<details>
<summary>Tips for new contributors</summary>

**Keeping your fork updated**

Before starting new work, sync with the main repo:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

> Note: Add the upstream remote to sync with the main repo:
>
> ```bash
> git remote add upstream https://github.com/EpicenterHQ/epicenter.git
> ```

**If your PR has conflicts**

Rebase your branch on the latest main:

```bash
git fetch upstream
git rebase upstream/main
```

</details>

## Local Development: Testing the CLI

If you're working on Epicenter's CLI (`packages/epicenter`), you can test it locally without publishing using `bun link`.

### One-Time Setup

Link the package globally from the package directory:

```bash
cd packages/epicenter
bun link
```

This makes the `epicenter` command available globally on your system, pointing to your local development version.

### Using the CLI

Now you can use the `epicenter` command from any directory:

```bash
epicenter --help
```

The CLI will use your local development version, so any changes you make to the CLI code will be reflected immediately.

### Unlinking

When you're done testing, you can unlink the package:

```bash
cd packages/epicenter
bun unlink
```

## Releasing

This section is for maintainers with npm publish access to the `@epicenter` scope.

### Prerequisites

- Bun installed (see above)
- An npm account with publish access to the `@epicenter` scope
- `npm login` completed in your terminal

### How versioning works

All seven public packages (`@epicenter/workspace`, `@epicenter/cli`, `@epicenter/sync`, `@epicenter/filesystem`, `@epicenter/skills`, `@epicenter/ui`, `@epicenter/svelte`) share a single version number. They move together.

**Apps are completely separate from changesets.** Changesets only touches packages that are (a) not marked `"private": true` and (b) listed under `packages/`. Every app in `apps/` is `"private": true` and has its own deploy mechanism—changesets will never version or publish them. Whispering versions come from `tauri.conf.json` and git tags. Web apps deploy on push to `main`. See [App deployments](#app-deployments) below.

We use [changesets](https://github.com/changesets/changesets) to track changes and publish. Never edit `version` fields in `package.json` by hand.

### Adding a changeset

After making changes to any package, run this before committing:

```bash
bunx changeset
```

Select the affected packages, pick the semver bump (patch for fixes, minor for new features), and write a short summary. Commit the generated `.changeset/*.md` file with your code.

### Publishing a release

```bash
# 1. Consume all pending changesets, bump versions, write CHANGELOGs
bunx changeset version

# 2. Commit
git add . && git commit -m "chore: release vX.Y.Z"

# 3. Publish to npm and create git tags
bunx changeset publish

# 4. Push
git push && git push --tags
```

### App deployments

Apps deploy separately from npm packages:

- **Whispering (desktop)**: Push a `v*` tag. `release.whispering.yml` builds for all four platforms and publishes a GitHub Release draft.
- **Web apps (Cloudflare Workers)**: Merge to `main`. `deploy.cloudflare.yml` deploys automatically.

See [`.github/workflows/README.md`](.github/workflows/README.md) for the full workflow reference.
## Coding Standards

### TypeScript

- Use `type` instead of `interface`
- Prefer absolute imports over relative imports
- Use object method shorthand syntax when appropriate

### Svelte

- We use Svelte 5 with the latest runes syntax
- Follow shadcn-svelte patterns for UI components
- Use Tailwind CSS for styling

### Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Test additions or changes
- `chore`: Maintenance tasks

Examples:

- `feat(whispering): add model selection for OpenAI providers`
- `fix(sound): resolve audio import paths`
- `docs: update contribution guidelines`

## Troubleshooting

### Version Mismatch Warning

If you see a warning about Bun version mismatch:

```bash
# Update to the latest Bun version
bun upgrade

# Or install the specific version mentioned in the warning
curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.19"
```

### Installation Issues

- Make sure you're in the repository root when running `bun install`
- Clear the cache if you encounter issues: `bun pm cache rm`
- On Windows, you may need to run your terminal as Administrator

## Getting Help

- **Discord**: Join our community at [go.epicenter.so/discord](https://go.epicenter.so/discord) and DM me to get started contributing
- **Issues**: Check existing issues or create a new one
- **Documentation**: Each app has its own README with specific details

## Licensing

Epicenter uses split licensing. Most packages and apps are MIT—contribute freely, no strings attached. The sync server (`apps/api`) and sync protocol (`packages/sync`) are AGPL-3.0. Contributions to either layer are welcome under their respective licenses.

See [FINANCIAL_SUSTAINABILITY.md](FINANCIAL_SUSTAINABILITY.md) for the full reasoning behind the split.

## Philosophy

We believe in:

- **Local-first**: Your data stays on your machine
- **Open source**: Everything is transparent and auditable
- **User ownership**: You own your data and choose your models
- **Simplicity**: Every change should be as simple as possible

## What We're Looking For

- Bug fixes and improvements to existing features
- Performance optimizations
- Documentation improvements
- New features that align with our local-first philosophy
- UI/UX enhancements

## Questions?

Feel free to:

- Open an issue for discussion
- Join our Discord and DM me directly to get started

Thank you for contributing to Epicenter! We're building something special together.
