# Whispering Minimize To Tray Design

Repo: `/home/dev/projects/whispering/.worktrees/windows-dpi-resume-fix`
Branch: `codex/windows-dpi-resume-fix`
Date: 2026-03-13

## Goal

Add an optional desktop behavior where minimizing Whispering hides it to the system tray, while clicking the close button still exits the app normally.

## Problem Summary

Whispering already creates a system tray icon and tray menu, but minimizing the main window behaves like a normal desktop app minimize. There is no user-facing setting for tray minimization and no app-shell hook that reacts to minimize events.

The desired behavior is narrow:

- minimize with the option off: normal minimize
- minimize with the option on: hide to tray
- close button: still close the app fully
- tray show action: restore the window cleanly

## Constraints

- Keep the change small and local.
- Do not intercept or override close behavior.
- Reuse the existing tray icon infrastructure.
- Do not add Rust-side window event handling unless the frontend hook proves insufficient.

## Approach Options

### Option 1: App-shell minimize hook plus one setting

Add a desktop-only setting, expose it in General settings, and register a small Tauri window listener in the app shell. When the window becomes minimized and the setting is enabled, hide the window.

Pros:

- Smallest surface area
- Keeps behavior aligned with Svelte settings state
- Reuses the existing tray menu and app-shell lifecycle

Cons:

- Relies on frontend window events instead of native Rust window handling

### Option 2: Native Rust minimize interception

Listen for window events in Tauri Rust and hide there when minimize occurs.

Pros:

- More native in theory

Cons:

- More invasive
- Harder to keep in sync with live Svelte settings state
- Not justified for a simple optional behavior

### Option 3: Tray-menu-only behavior

Expose more tray actions but do not auto-hide on minimize.

Pros:

- Very little code

Cons:

- Does not satisfy the actual requested behavior

## Recommended Approach

Use Option 1.

Add one new boolean setting, wire it into General settings, and register a small Tauri-only minimize watcher in the app shell. The watcher should check `isMinimized()` on resize events and hide the window only when the new option is enabled.

## Design Details

### Settings Surface

Add a new flat setting:

- `'system.minimizeToTray': 'boolean = false'`

Expose it in the desktop-only portion of the General settings page near the other app-behavior controls.

The default should stay off so existing behavior does not change until the user opts in.

### App Shell Behavior

Add a helper under `src/routes/(app)/_layout-utils/` that:

- exits immediately outside Tauri
- subscribes to `getCurrentWindow().onResized(...)`
- checks `await currentWindow.isMinimized()`
- if minimized and the setting is enabled, calls `hide()`
- returns a cleanup function that unregisters the listener

This keeps the behavior local to the main desktop shell instead of scattering it across components.

### Tray Restore Behavior

Update the existing tray `Show Window` action so it:

- calls `unminimize()`
- then calls `show()`

This avoids leaving the window logically minimized when restoring it from the tray.

### Permissions

The main-window capability should explicitly allow the narrow extra window commands this feature uses:

- `core:window:allow-is-minimized`
- `core:window:allow-unminimize`

## Testing Strategy

Add two focused tests:

- a small source-level test proving the new setting and settings toggle exist
- a unit test for the minimize helper covering:
  - no-op outside Tauri
  - no-op when the setting is off
  - hide on minimized window when the setting is on
  - listener cleanup

Then rerun:

- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`
