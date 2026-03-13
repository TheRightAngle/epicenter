/**
 * Workspace — schema and client for Fuji personal content app.
 *
 * Fuji is a personal CMS with a 1:1 mapping to your blog. Entries are content
 * pieces—articles, thoughts, ideas—organized by tags and type, displayed in a
 * data table with an editor panel. Each entry has a Y.Text body for
 * collaborative rich-text editing via Tiptap + y-prosemirror.
 *
 * Contains the branded EntryId type, entries table definition with
 * DateTimeString timestamps, KV settings, and the workspace client with
 * IndexedDB persistence.
 */

import {
	createWorkspace,
	DateTimeString,
	dateTimeStringNow,
	defineKv,
	defineTable,
	defineWorkspace,
	generateId,
	type InferTableRow,
} from '@epicenter/workspace';
import { indexeddbPersistence } from '@epicenter/workspace/extensions/sync/web';
import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';

// ─── Branded IDs ──────────────────────────────────────────────────────────────

/**
 * Branded entry ID — nanoid generated when an entry is created.
 *
 * Prevents accidental mixing with other string IDs at compile time.
 */
export type EntryId = string & Brand<'EntryId'>;
export const EntryId = type('string').pipe((s): EntryId => s as EntryId);

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * Entries table — content pieces in a personal CMS.
 *
 * Unlike v1's timeline-only notes, entries are typed and tagged content. The
 * `type` field categorizes entries (article, thought, reading, etc.) while
 * `tags` provide freeform cross-cutting labels (crdt, open-source, etc.).
 *
 * The `title` field is explicit and required—blog posts have titles. The
 * `preview` column stores the first ~100 chars of body content for table
 * display.
 *
 * Each entry has a Y.Text document (`body`) for collaborative rich-text
 * editing. The document GUID matches the entry `id` so there's a 1:1 mapping.
 * Updates to the document automatically touch `updatedAt`.
 */
const entriesTable = defineTable(
	type({
		id: EntryId,
		title: 'string',
		preview: 'string',
		'type?': 'string[] | undefined',
		'tags?': 'string[] | undefined',
		createdAt: DateTimeString,
		updatedAt: DateTimeString,
		_v: '2',
	}),
).withDocument('body', {
	guid: 'id',
	onUpdate: () => ({ updatedAt: dateTimeStringNow() }),
});

export type Entry = InferTableRow<typeof entriesTable>;

// ─── Workspace ────────────────────────────────────────────────────────────────

export const fujiWorkspace = defineWorkspace({
	id: 'epicenter.fuji' as const,
	tables: { entries: entriesTable },
	kv: {
		selectedEntryId: defineKv(EntryId.or(type('null'))),
		viewMode: defineKv(type("'table' | 'timeline'")),
		sidebarCollapsed: defineKv(type('boolean')),
	},
});

/**
 * Fuji workspace client — single Y.Doc instance with IndexedDB persistence.
 *
 * Access tables via `workspaceClient.tables.entries` and KV settings via
 * `workspaceClient.kv`. The client is ready when `workspaceClient.whenReady`
 * resolves.
 */
export default createWorkspace(fujiWorkspace).withExtension(
	'persistence',
	indexeddbPersistence,
);
