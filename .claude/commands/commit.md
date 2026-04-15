---
description: Create git commits following this repo's conventions
---

# Commit Changes

## Step 1: Load the git skill

Load the `git` skill to get conventional commit rules, type/scope guidelines, and message best practices. That skill is the authority—follow it exactly.

## Step 2: Gather context (parallel)

Run these simultaneously:

```bash
git status
git diff
git diff --staged
git log --oneline -5
```

## Step 3: Plan commits

- Review the conversation history to understand what was accomplished and why
- Decide: one commit or multiple? Use the `incremental-commits` skill if splitting across 3+ files
- Group related files together
- Draft conventional commit messages—imperative mood, lowercase after colon, no period
- The "why" matters more than the "what" in commit bodies

## Step 4: Present plan and wait for confirmation

```
I plan to create [N] commit(s):

**Commit 1**: `type(scope): description`
Files: [list]

**Commit 2**: `type(scope): description`
Files: [list]

Shall I proceed?
```

## Step 5: Execute

- `git add` with specific files (never `-A` or `.`)
- Use HEREDOC for multi-line messages:
  ```bash
  git commit -m "$(cat <<'EOF'
  type(scope): brief description

  Why this change was made.
  EOF
  )"
  ```
- Show result with `git log --oneline -n [N]`

## Rules

- NEVER add co-author lines, AI attribution, or tool watermarks
- NEVER commit files that likely contain secrets
- Always ask for confirmation before committing
- Keep first line under 72 characters
