# Whispering Windows DPI Resume Fix Design

Repo: `/home/dev/projects/whispering/.worktrees/windows-dpi-resume-fix`
Branch: `codex/windows-dpi-resume-fix`
Date: 2026-03-13

## Goal

Fix the Windows-only wake/resume rendering bug where Whispering's window bounds stay correct, but the inner webview content comes back oversized until the user manually resizes the window.

## Problem Summary

The bug shows up in a narrow path:

- Whispering is minimized or backgrounded.
- The monitor sleeps.
- The user wakes the monitor and restores Whispering.
- The window frame size is correct.
- The inner webview scale is stale until any manual resize.

This points to a stale WebView2/Tauri layout or DPI state after wake, not to an application-wide layout bug.

## Constraints

- Keep the fix as small and local as possible.
- Do not introduce broad UI rewrites or native Rust changes.
- Do not change normal resize, scrolling, rendering, or monitor-move behavior unless needed for this exact issue.
- Do not add enterprise-style hardening or unrelated cleanup.

## Approach Options

### Option 1: App-shell wake/DPI recovery hook

Add a small Tauri-only helper in the app shell that listens for window scale and restore-adjacent events, then triggers a one-shot relayout only if the webview still appears stale.

Pros:

- Smallest code surface.
- Targets the exact failure path.
- Easy to remove or adjust if needed.

Cons:

- It is a workaround around stack behavior, not a native WebView2 fix.

### Option 2: Broad focus/restore relayout hook

Trigger a relayout every time the window regains focus or becomes visible.

Pros:

- Simpler than a guarded implementation.

Cons:

- Higher chance of unnecessary jitter.
- Runs on many normal interactions that are unrelated to the bug.

### Option 3: Native-side WebView2 workaround

Patch the Tauri/Rust side to force a deeper webview refresh on Windows wake.

Pros:

- Most native in theory.

Cons:

- Much larger surface area.
- Harder to validate and maintain.
- Not justified for a bug that already has a reliable user workaround via resize.

## Recommended Approach

Use Option 1.

Implement a small Tauri-only app-shell helper that:

- subscribes to `onScaleChanged`
- subscribes to a narrow restore path via focus and document visibility return
- checks whether `window.devicePixelRatio` disagrees with Tauri's `scaleFactor()`
- only if they disagree, performs a one-shot relayout nudge equivalent to the manual resize that already fixes the issue

## Design Details

### Trigger Surface

The fix should live in the top-level Whispering app shell, not in individual pages or components.

It should only be active when running inside Tauri. Browser/dev-web behavior should stay unchanged.

Triggers:

- `getCurrentWindow().onScaleChanged(...)`
- `getCurrentWindow().onFocusChanged(...)` when focus becomes true
- `document.visibilitychange` when the document becomes visible again

These cover the likely wake/restore path without broadening the fix to every window interaction.

### Recovery Mechanism

The recovery hook should stay dormant unless the scale state looks stale.

Detection:

- read `window.devicePixelRatio`
- read `await getCurrentWindow().scaleFactor()`
- treat a meaningful mismatch as a stale post-wake scale state

Recovery:

- schedule one recovery pass per clustered event burst
- read the current physical window size
- nudge the size just enough to trigger the same relayout path as a manual resize
- restore the original size immediately

The visible window geometry should end up exactly where it started.

### Safety

- No Rust changes.
- No layout rewrites.
- No effect in browser mode.
- No action if the scale factors already match.
- Coalesce clustered events so monitor wake does not fire repeated relayout nudges.

## Testing Strategy

Add a focused testable helper rather than burying all logic inside `AppLayout.svelte`.

Tests should cover:

- no-op outside Tauri
- registration and cleanup of listeners
- recovery path only when `devicePixelRatio` and Tauri `scaleFactor()` disagree
- clustered events only schedule one relayout pass
- no-op when scale state is already correct

Runtime success criteria:

- after monitor sleep and restore, opening Whispering should return at the correct inner scale without manual resize
- normal focus changes should not visibly jiggle the window
- browser/dev-web mode should behave exactly as before
