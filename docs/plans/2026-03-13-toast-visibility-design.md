# Toast Visibility Design

**Date:** 2026-03-13

## Goal

Reduce in-app toast noise without changing OS notifications.

## Decision

Add a single settings key with three modes:

- `all`
- `important-only`
- `off`

This applies only to in-app toasts. OS notifications keep their current behavior.

## Scope

- Add the new setting to the core settings schema.
- Expose it in General settings.
- Filter toast display in the notify/query layer before calling the toast service.

## Behavior

- `all`: current behavior
- `important-only`: show only `warning` and `error` toasts
- `off`: show no in-app toasts

The notification log and OS notifications remain unchanged.

## Reasoning

This is the smallest useful change:

- it fixes the “toast heavy” problem directly
- it avoids touching every individual caller
- it does not silently remove OS notifications or other feedback channels
