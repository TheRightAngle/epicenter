# CI/CD Workflows

All workflows live flat in `.github/workflows/` (GitHub Actions requirement). We use **period-delimited prefixes** so they group naturally when sorted alphabetically. Periods are structural delimiters (category from name); hyphens are word separators within a segment.

## Naming Convention

| Prefix | Purpose | Scope |
|---|---|---|
| `release.{app}` | Tag-triggered desktop builds + GitHub Release | Per Tauri app (expensive 4-platform matrix) |
| `pr-preview.{app}` | PR preview desktop builds | Per Tauri app (expensive 4-platform matrix) |
| `deploy.{target}` | Web app deployment | All web apps together (cheap, fast) |
| `ci.{name}` | Code quality checks | Whole repo |
| `auto.{name}` | Automated repo maintenance | Whole repo |
| `meta.{name}` | Repo housekeeping | Whole repo |

Tauri desktop apps get **separate per-app workflows** because builds run a 4-platform matrix (macOS ARM, macOS Intel, Ubuntu, Windows) taking 20+ minutes. A PR touching only Whispering shouldn't trigger an Epicenter build.

Web apps (Cloudflare Workers) deploy **together in one workflow** because deploys are fast (~2 min on a single runner) and share the same build step.

## Workflows

### Desktop Releases

| File | Trigger | What it does |
|---|---|---|
| `release.whispering.yml` | `v*` tags, manual | Builds Whispering for 4 platforms, publishes to GitHub Releases as draft. Includes code signing, notarization, and release notes from `docs/release-notes/`. |
| `pr-preview.whispering.yml` | Pull requests | Builds Whispering for 4 platforms, uploads as PR artifacts. Cancels previous builds via concurrency groups. |

### Web Deployment (Cloudflare Workers)

| File | Trigger | What it does |
|---|---|---|
| `deploy.cloudflare.yml` | Push to `main`, manual | Validates (typecheck, lint, build), then deploys Whispering + Landing to Cloudflare Workers in parallel. Posts Discord notification. |
| `deploy.cloudflare-preview.yml` | Pull requests touching `apps/whispering/**`, `apps/landing/**`, `packages/**` | Uploads preview versions via `wrangler versions upload --preview-alias`. Posts PR comment with preview URLs. No cleanup needed (aliases auto-expire at 1000). |

### CI

| File | Trigger | What it does |
|---|---|---|
| `ci.format.yml` | Push, pull requests | Runs `bun run lint:check` and `bun run typecheck`. |
| `ci.autofix.yml` | Push, pull requests | Runs `bun run format` and commits fixes back via autofix-ci. |

### Automation

| File | Trigger | What it does |
|---|---|---|
| `auto.label-issues.yml` | Issues opened/edited | Uses Claude to auto-label issues by type, priority, platform, and area. |
| `auto.release.yml` | PR merged to `main` | Bumps version, collects `## Changelog` entries from merged PRs, commits release, tags, creates GitHub Release with grouped changelog. |
| changesets (manual) | Manual | `bunx changeset version` + `bunx changeset publish`. `@changesets/action` will automate this later. |

## Package Releases (npm)

We use [changesets](https://github.com/changesets/changesets) to version and publish npm packages.

### Public and private packages

| Package | npm name | Published |
|---|---|---|
| `packages/workspace` | `@epicenter/workspace` | yes |
| `packages/cli` | `@epicenter/cli` | yes |
| `packages/sync` | `@epicenter/sync` | yes |
| `packages/filesystem` | `@epicenter/filesystem` | yes |
| `packages/skills` | `@epicenter/skills` | yes |
| `packages/ui` | `@epicenter/ui` | yes |
| `packages/svelte-utils` | `@epicenter/svelte` | yes |
| `packages/ai` | `@epicenter/ai` | no (private) |
| `packages/constants` | `@epicenter/constants` | no (private) |
| `packages/vault` | `@epicenter/vault` | no (private) |

### Fixed version group

All seven public packages share one version number, configured via the `fixed` array in `.changeset/config.json`. When any one of them changes, all seven bump together. This keeps the ecosystem coherent: if you install `@epicenter/workspace@0.3.0`, you know `@epicenter/cli@0.3.0` is the matching release.

### Day-to-day: adding a changeset

After making changes to any package, record what changed before committing:

```bash
bunx changeset
```

The CLI will ask which packages changed, what semver bump applies (patch/minor/major), and for a short summary. It writes a `.changeset/*.md` file. Commit that file alongside your code changes.

Don't skip this step. Without a changeset, the change won't appear in the CHANGELOG and won't trigger a version bump.

### Cutting a release

When you're ready to publish accumulated changesets:

1. Bump versions and write CHANGELOGs:
   ```bash
   bunx changeset version
   ```

2. Commit the result:
   ```bash
   git add . && git commit -m "chore: release vX.Y.Z"
   ```

3. Publish to npm and create git tags:
   ```bash
   bunx changeset publish
   ```

4. Push commits and tags:
   ```bash
   git push && git push --tags
   ```

### What not to do

- Don't manually edit `version` fields in `package.json`. Changesets owns those.
- Don't run `npm publish` or `bun publish` directly. `bunx changeset publish` handles the registry upload and git tagging together.

### Meta

| File | Trigger | What it does |
|---|---|---|
| `meta.sponsors-readme.yml` | Daily schedule, manual | Updates README sponsors section. |
| `meta.sync-releases.yml` | Release published/edited, manual | Mirrors releases from EpicenterHQ/epicenter to braden-w/whispering (downstream). |
| `meta.update-readme-version.yml` | Release published, manual | Updates download link versions in Whispering README via sed. |

### Uncategorized

| File | Trigger | What it does |
|---|---|---|
| `claude.yml` | `@claude` mentions in issues/PRs | Runs Claude Code agent to respond. One-off, no prefix needed. |

## Secrets Reference

| Secret | Used by | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `deploy.cloudflare`, `deploy.cloudflare-preview` | Cloudflare API token with Workers Scripts:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy.cloudflare`, `deploy.cloudflare-preview` | Cloudflare account ID |
| `DISCORD_WEBHOOK_URL` | `deploy.cloudflare` | Discord webhook for deployment notifications (optional) |
| `TAURI_SIGNING_PRIVATE_KEY` | `release.whispering`, `pr-preview.whispering` | Tauri update signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `release.whispering`, `pr-preview.whispering` | Tauri signing key password |
| `APPLE_CERTIFICATE` | `release.whispering`, `pr-preview.whispering` | macOS code signing certificate (base64) |
| `APPLE_CERTIFICATE_PASSWORD` | `release.whispering`, `pr-preview.whispering` | macOS certificate password |
| `APPLE_SIGNING_IDENTITY` | `release.whispering`, `pr-preview.whispering` | macOS signing identity |
| `APPLE_ID` | `release.whispering`, `pr-preview.whispering` | Apple ID for notarization |
| `APPLE_PASSWORD` | `release.whispering`, `pr-preview.whispering` | Apple app-specific password |
| `APPLE_TEAM_ID` | `release.whispering`, `pr-preview.whispering` | Apple Developer team ID |
| `GH_ACTIONS_PAT` | `auto.release`, `meta.sync-releases`, `meta.sponsors-readme`, `meta.update-readme-version` | PAT with repo + read:org scope for pushing commits/tags and creating releases |
| `ANTHROPIC_API_KEY` | `auto.label-issues`, `claude` | Anthropic API key for Claude |

## Rollback

**Web apps**: Revert the commit on `main` and push, or for immediate rollback: `bunx wrangler rollback --name <worker-name>`.

**Desktop releases**: Delete the draft release and re-tag from an earlier commit.
