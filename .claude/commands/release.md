---
description: Analyze changes and create a new version release
---

# Create a New Release

## Step 1: Identify changes since last release

```bash
LATEST_TAG=$(git tag --sort=-version:refname | head -1)
echo "Latest tag: $LATEST_TAG"

git log "$LATEST_TAG..HEAD" --oneline
gh pr list --state merged --base main --limit 100 --json number,title,author,mergedAt
```

## Step 2: Categorize changes

Review all commits and merged PRs:

**User-facing (highlight these):**
- Features (`feat:`): new functionality
- Fixes (`fix:`): bugs that were annoying users
- Performance (`perf:`): speed improvements users will feel

**Internal (mention briefly if significant):**
- Refactoring, migrations, infrastructure changes
- Only include if foundational (e.g., "encryption model rewrite")

**Skip:** docs, chores, CI (unless user-relevant)

## Step 3: Determine version bump

This monorepo uses a unified version scheme (`8.Y.Z`), major version 8 is permanent:
- **Minor** (`8.Y+1.0`): new features, backward compatible
- **Patch** (`8.Y.Z+1`): bug fixes only

Present your recommendation with reasoning.

## Step 4: Execute the bump

Once confirmed:

```bash
git checkout main
git pull origin main
bun run scripts/bump-version.ts [VERSION]
```

## Step 5: Draft release notes

Generate TWO versions:

### GitHub Release Notes

```markdown
# vX.Y.Z: [Catchy 2-4 Word Summary]

[1-2 sentence narrative intro framing what users can now DO.]

## [Feature Name]
[2-3 sentences: what it is, why it matters, how to use it.]

## What's Changed
### Features
* feat: description by @author in #NNN

### Bug Fixes
* fix: description by @author in #NNN

## New Contributors
* @username made their first contribution in #NNN

**Full Changelog**: https://github.com/EpicenterHQ/epicenter/compare/vOLD...vNEW

---
**Questions?** Join our [Discord](https://go.epicenter.so/discord)
**Love Epicenter?** [Star us on GitHub](https://github.com/EpicenterHQ/epicenter)
```

### Discord Announcement

```
**vX.Y.Z is out!**

[Headline feature in 1-2 sentences]
[Second feature or major fix]

Also in this release:
- [Quick bullet]
- [Quick bullet]

Full release notes: [link]
```

## Rules

- Load the `writing-voice` skill for tone
- Verify all @mentions with `gh pr view <N> --json author` before using them
- Lead with what users can DO, not what we changed
- No marketing language or dramatic hyperbole
- Bump script runs from repo root, not a subdirectory
