/**
 * Honeycrisp workspace factory — creates a workspace client with domain actions.
 *
 * Includes cross-table mutations (e.g. folder deletion with note re-parenting)
 * that touch multiple tables and KV in a single logical operation. Simple
 * single-table CRUD stays in the Svelte state files.
 *
 * Returns a non-terminal builder. Consumers chain `.withExtension()` to add
 * persistence, encryption, sync, or other capabilities.
 *
 * @example
 * ```typescript
 * import { createHoneycrisp } from '@epicenter/honeycrisp/workspace'
 *
 * const ws = createHoneycrisp()
 *   .withExtension('persistence', indexeddbPersistence)
 *
 * // Multi-table mutation via actions
 * ws.actions.folders.delete({ folderId: 'abc' })
 * ```
 */

import { createWorkspace, defineMutation } from '@epicenter/workspace';
import Type from 'typebox';
import { type FolderId, honeycrisp } from './definition';

export function createHoneycrisp() {
	return createWorkspace(honeycrisp).withActions(({ tables, kv }) => ({
		folders: {
			/**
			 * Delete a folder and move all its notes to unfiled.
			 *
			 * Re-parents every note in the folder (sets `folderId` to undefined),
			 * deletes the folder row, and clears the KV selection if the deleted
			 * folder was selected. This is the only cross-table mutation in
			 * Honeycrisp — notes + folders + KV in one operation.
			 */
			delete: defineMutation({
				description:
					'Delete a folder, re-parent its notes to unfiled, and clear selection',
				input: Type.Object({ folderId: Type.String() }),
				handler: ({ folderId: rawId }) => {
					const folderId = rawId as FolderId;
					const folderNotes = tables.notes
						.getAllValid()
						.filter((n) => n.folderId === folderId);
					for (const note of folderNotes) {
						tables.notes.update(note.id, { folderId: undefined });
					}
					tables.folders.delete(folderId);
					if (kv.get('selectedFolderId') === folderId) {
						kv.set('selectedFolderId', null);
					}
				},
			}),
		},
	}));
}
