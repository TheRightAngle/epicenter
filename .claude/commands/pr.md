---
description: Create a pull request for the current branch
---

# Create Pull Request

## Step 1: Load skills and references

1. Load the `git` skill
2. Read `.agents/skills/git/references/pull-request-guidelines.md`—this is the authority on PR description voice, structure, and formatting. Follow it exactly.
3. Read `.agents/skills/git/references/github-pr-operations.md`—for issue linking, username verification, and merge strategy.

## Step 2: Gather context (parallel)

```bash
git status
git log --oneline main..HEAD
git diff main...HEAD --stat
git diff main...HEAD
git branch -vv | grep '\*'
```

## Step 3: Scan for related issues

```bash
gh issue list --state open --limit 100 --json number,title,labels
```

Scan titles for keywords matching the PR's scope. If any match, read with `gh issue view <N>` and reference appropriately:
- `Closes #N`—only if fully resolved
- `Partially addresses #N`—if improved but not fixed
- `Lays groundwork for #N`—if prerequisite work

## Step 4: Check for problems

- If there are uncommitted changes on tracked files that belong to this branch, warn before proceeding
- If the branch has no commits ahead of main, stop—nothing to PR

## Step 5: Write the PR

Title: conventional commit format—`type(scope): description`

Body: follow the PR guidelines reference exactly. Key points:
- Continuous prose, no `## Summary` or bullet changelogs
- Open with WHY, weave WHAT into the narrative
- Code examples mandatory for API changes
- Before/after snippets for refactors
- ASCII diagrams for architecture changes
- Bold topic sentences with `---` for multi-concern PRs
- Casual closing stat

## Step 6: Push and create

```bash
git push -u origin <branch>

gh pr create --head <branch> --title "..." --body "$(cat <<'EOF'
...
EOF
)"
```

## Step 7: Return the PR URL

## Rules

- NEVER include AI attribution or watermarks
- NEVER use `## Summary`, `## Changes`, or bullet-point changelogs
- Verify GitHub usernames with `gh` before @mentioning anyone
- The PR guidelines reference is the authority—re-read it when in doubt
