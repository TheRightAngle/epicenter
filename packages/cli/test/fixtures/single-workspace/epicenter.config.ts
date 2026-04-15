/**
 * Single-workspace fixture — one named export.
 *
 * Tests that loadConfig() discovers and loads a config file with exactly
 * one workspace client. This is the most common setup: one app, one export.
 */

import { createHoneycrisp } from '@epicenter/honeycrisp/workspace';

export const honeycrisp = createHoneycrisp();
