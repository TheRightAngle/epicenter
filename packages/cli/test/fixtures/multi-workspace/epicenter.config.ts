/**
 * Multi-workspace fixture — two named exports.
 *
 * Tests that loadConfig() discovers multiple workspace clients from a single
 * config file and that workspace selection (--workspace flag) correctly
 * disambiguates between them.
 */

import { createHoneycrisp } from '@epicenter/honeycrisp/workspace';
import { createTabManagerWorkspace } from '@epicenter/tab-manager/workspace';

export const honeycrisp = createHoneycrisp();
export const tabManager = createTabManagerWorkspace();
