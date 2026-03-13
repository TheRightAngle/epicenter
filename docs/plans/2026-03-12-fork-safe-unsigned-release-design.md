# Fork-Safe Unsigned Release Workflow Design

**Problem**

`release.whispering.yml` currently assumes release-signing secrets exist and are valid. On a fork, the Tauri build itself succeeds, but the workflow fails afterward in signing:

- Windows and Linux fail in updater signing after bundles are already produced.
- macOS fails in codesigning when empty Apple secrets are passed into `tauri-action`.

That means fork builds do not finish even though the app compiles.

**Approaches Considered**

1. Always force `--no-sign` in the release workflow.
   This is the smallest patch and would make the fork pass, but it downgrades the upstream release workflow too.

2. Add a separate Windows-only unsigned workflow.
   This is low risk and cheap, but it splits the build story across two workflows and no longer mirrors the existing release path.

3. Keep the existing release workflow, but automatically fall back to unsigned builds when signing secrets are unavailable.
   This preserves signed upstream releases, makes forked releases finish, and keeps the existing tag-based draft release flow.

**Recommendation**

Take approach 3.

It fixes the actual failure mode at the workflow boundary instead of hard-forking release behavior. On the user fork, the workflow will build unsigned artifacts and finish. On the upstream repo, valid secrets will continue to enable signed releases.

**Design**

- Add a `Determine signing mode` step in `.github/workflows/release.whispering.yml`.
- The step will inspect the required secrets for the current matrix target:
  - all platforms need the Tauri updater signing key pair for signed releases
  - macOS additionally needs the Apple signing and notarization secrets
- If the required secrets are present, keep the current signed `tauri-action` path.
- If any required secrets are missing, switch to an unsigned `tauri-action` invocation with `--no-sign`.
- Use two separate `tauri-action` steps so the unsigned path does not pass empty signing variables into the action.
- Leave `pr-preview.whispering.yml` unchanged because it is already correctly unsigned.

**Verification**

- Validate the workflow YAML locally.
- Confirm the signed and unsigned branches are syntactically well-formed.
- Push the workflow change to the fork branch and rerun the release workflow on the fork tag to confirm it finishes.
