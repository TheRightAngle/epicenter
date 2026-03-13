# Recording Device Label Disambiguation Design

## Goal

Make ambiguous recording-device entries in Whispering’s settings readable on Windows without changing how devices are actually selected or stored.

## Problem

The recording settings UI already renders whatever label each recorder backend returns. On some Windows setups, those labels collapse to generic entries like `Microphone` and `Microphone`, which makes it hard to distinguish the laptop mic from a webcam mic.

The selector is not the real issue. The app needs a small display-layer improvement that only changes labels when two or more devices would otherwise look identical.

## Recommended Approach

Add a shared device-label utility that:

1. Leaves unique labels untouched.
2. Detects duplicate visible labels.
3. Uses a richer parallel label source when available.
4. Falls back to deterministic numbering only when no better detail exists.

For desktop manual recording, the richest low-risk secondary source is browser-style microphone enumeration from the navigator path. That lets Whispering try to derive a Zoom-like suffix such as `Microphone (USB Camera)` while still keeping the real recorder device ID unchanged. If that richer label is unavailable or unusable, the app will show `Microphone (1)` and `Microphone (2)` instead of two indistinguishable `Microphone` rows.

## Scope

This change is intentionally narrow:

- Improve display labels in manual recording device selection.
- Improve VAD device labels with the same shared utility when duplicates exist.
- Keep stored device IDs exactly as they are today.
- Do not change recorder startup, fallback logic, or how devices are matched for recording.

## Data Flow

Manual recording path:

1. Enumerate devices from the selected recorder backend.
2. If running on desktop, also try navigator enumeration for richer labels.
3. Pass both lists through a shared disambiguation helper.
4. Return the same device IDs with improved display labels.

VAD path:

1. Enumerate navigator devices as today.
2. Pass that list through the same disambiguation helper.
3. Show improved labels only when collisions exist.

## Matching Strategy

The helper will be conservative:

- It only modifies labels inside duplicate groups.
- If a parallel “detail” label already looks like `Microphone (Realtek Audio)`, it extracts the inner detail and renders `Microphone (Realtek Audio)`.
- If the richer label differs entirely, it appends that label as detail.
- If no reliable extra detail is available, it uses numbered suffixes.

This keeps the best-case path useful while making the fallback deterministic and low risk.

## Risks

- Desktop and navigator device lists may not always line up perfectly by order. The helper should only borrow richer detail when it has a plausible aligned label; otherwise it should fall back to numbering.
- Some environments may still expose only generic names. In that case the UI becomes distinguishable, but not semantically rich.

## Verification

- Pure unit tests for duplicate-label disambiguation behavior.
- Focused tests for:
  - unique labels unchanged
  - duplicate labels use richer navigator-style detail when available
  - fallback numbering when no richer detail exists
- `bun run --cwd apps/whispering typecheck`
- `bun run --cwd apps/whispering build`
