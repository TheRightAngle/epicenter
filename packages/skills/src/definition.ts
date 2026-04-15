/**
 * @fileoverview Workspace definition for agent skills.
 *
 * Combines `skillsTable` and `referencesTable` under the standard
 * `epicenter.skills` workspace ID. Most consumers should use
 * `createSkillsWorkspace()` from `./workspace.js` instead—this is exported
 * for advanced use cases like embedding skills tables in a custom workspace.
 *
 * @module
 */

import { defineWorkspace } from '@epicenter/workspace';
import { referencesTable, skillsTable } from './tables.js';

/**
 * Pre-built workspace definition for the skills workspace.
 *
 * Combines `skillsTable` and `referencesTable` under the standard
 * `epicenter.skills` workspace ID. Most consumers should use
 * `createSkillsWorkspace()` instead—this is exported for advanced use cases
 * like embedding skills tables in a custom workspace.
 */
export const skillsDefinition = defineWorkspace({
	id: 'epicenter.skills',
	tables: { skills: skillsTable, references: referencesTable },
	kv: {},
});
