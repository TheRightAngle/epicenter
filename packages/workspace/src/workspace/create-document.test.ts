/**
 * createDocuments Tests
 *
 * Validates documents lifecycle, handle read/write behavior, and integration with table row metadata.
 * The suite protects contracts around open/close idempotency, handle pattern, cleanup semantics, and hook orchestration.
 *
 * Key behaviors:
 * - Document operations keep row metadata in sync and honor documents origins.
 * - Lifecycle methods (`close`, `closeAll`) safely clean up open documents.
 */

import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
	type CreateDocumentsConfig,
	createDocuments,
	DOCUMENTS_ORIGIN,
} from './create-document.js';
import { createTables } from './create-tables.js';
import { createWorkspace } from './create-workspace.js';
import { defineTable } from './define-table.js';
import type { AwarenessDefinitions } from './types.js';

const fileSchema = type({
	id: 'string',
	name: 'string',
	updatedAt: 'number',
	_v: '1',
});
const cursorSchema = type({ x: 'number', y: 'number' });

function setupTables() {
	const ydoc = new Y.Doc({ guid: 'test-workspace' });
	const tables = createTables(ydoc, { files: defineTable(fileSchema) });
	return { ydoc, tables };
}

function setup(
	overrides?: Pick<
		CreateDocumentsConfig<typeof fileSchema.infer>,
		'documentExtensions'
	> & {
		awarenessDefinitions?: AwarenessDefinitions;
	},
) {
	const { ydoc, tables } = setupTables();
	const documents = createDocuments({
		id: 'test-workspace',
		tableName: 'files',
		documentName: 'content',
		guidKey: 'id',
		onUpdate: () => ({ updatedAt: Date.now() }),
		tableHelper: tables.files,
		ydoc,
		...overrides,
	});
	return { ydoc, tables, documents };
}

describe('createDocuments', () => {
	describe('open', () => {
		test('returns a handle with a Y.Doc (gc: false)', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle = await documents.open('f1');
			expect(handle.ydoc).toBeInstanceOf(Y.Doc);
			expect(handle.ydoc.gc).toBe(false);
		});

		test('handle exposes tableName and documentName', async () => {
			const { documents } = setup();
			const handle = await documents.open('f1');
			expect(handle.tableName).toBe('files');
			expect(handle.documentName).toBe('content');
		});

		test('document extension factory receives tableName and documentName in context', async () => {
			let receivedTableName: string | undefined;
			let receivedDocumentName: string | undefined;
			const { documents } = setup({
				documentExtensions: [
					{
						key: 'test',
						factory: (ctx) => {
							receivedTableName = ctx.tableName;
							receivedDocumentName = ctx.documentName;
						},
					},
				],
			});
			await documents.open('f1');
			expect(receivedTableName).toBe('files');
			expect(receivedDocumentName).toBe('content');
		});

		test('document extension factory can return void to skip', async () => {
			const { documents } = setup({
				documentExtensions: [
					{
						key: 'skipped',
						factory: () => {
							return; // void — opt out
						},
					},
				],
			});
			const handle = await documents.open('f1');
			expect(handle.extensions.skipped).toBeUndefined();
		});

		test('is idempotent — same GUID returns same underlying Y.Doc', async () => {
			const { documents } = setup();

			const handle1 = await documents.open('f1');
			const handle2 = await documents.open('f1');
			expect(handle1.ydoc).toBe(handle2.ydoc);
		});

		test('open accepts a row object and resolves guid', async () => {
			const { tables, documents } = setup();
			const row = {
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			} as const;
			tables.files.set(row);

			const handle = await documents.open(row);
			expect(handle.ydoc.guid).toBe('f1');
		});

		test('open accepts a string guid directly', async () => {
			const { documents } = setup();

			const handle = await documents.open('f1');
			expect(handle.ydoc.guid).toBe('f1');
		});
	});

	describe('handle content read and write', () => {
		test('read returns empty string for new doc', async () => {
			const { documents } = setup();

			const handle = await documents.open('f1');
			const text = handle.read();
			expect(text).toBe('');
		});

		test('write replaces text content, then read returns it', async () => {
			const { documents } = setup();

			const handle = await documents.open('f1');
			handle.write('hello world');
			const text = handle.read();
			expect(text).toBe('hello world');
		});

		test('write replaces existing content', async () => {
			const { documents } = setup();

			const handle = await documents.open('f1');
			handle.write('first');
			handle.write('second');
			const text = handle.read();
			expect(text).toBe('second');
		});
	});

	describe('onUpdate callback', () => {
		test('content doc change invokes onUpdate and writes returned fields', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle = await documents.open('f1');
			handle.write('hello');

			// Give the update observer a tick
			const result = tables.files.get('f1');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				expect(result.row.updatedAt).toBeGreaterThan(0);
			}
		});

		test('onUpdate callback return values are written to the row', async () => {
			const customSchema = type({
				id: 'string',
				name: 'string',
				updatedAt: 'number',
				lastEditedBy: 'string',
				_v: '1',
			});
			const ydoc = new Y.Doc({ guid: 'test-custom-onUpdate' });
			const tables = createTables(ydoc, {
				files: defineTable(customSchema),
			});

			const documents = createDocuments({
				id: 'test-custom-onUpdate',
				tableName: 'files',
				documentName: 'content',
				guidKey: 'id',
				onUpdate: () => ({
					updatedAt: 999,
					lastEditedBy: 'test-user',
				}),
				tableHelper: tables.files,
				ydoc,
			});

			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				lastEditedBy: '',
				_v: 1,
			});

			const handle = await documents.open('f1');
			handle.write('hello');

			const result = tables.files.get('f1');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				expect(result.row.updatedAt).toBe(999);
				expect(result.row.lastEditedBy).toBe('test-user');
			}
		});

		test('onUpdate returning empty object is a no-op', async () => {
			const ydoc = new Y.Doc({ guid: 'test-noop-onUpdate' });
			const tables = createTables(ydoc, {
				files: defineTable(fileSchema),
			});

			const documents = createDocuments({
				id: 'test-noop-onUpdate',
				tableName: 'files',
				documentName: 'content',
				guidKey: 'id',
				onUpdate: () => ({}),
				tableHelper: tables.files,
				ydoc,
			});

			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle = await documents.open('f1');
			handle.write('hello');

			const result = tables.files.get('f1');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				expect(result.row.updatedAt).toBe(0); // unchanged
			}
		});

		test('onUpdate bump uses DOCUMENTS_ORIGIN', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			let capturedOrigin: unknown = null;
			tables.files.observe((_changedIds, origin) => {
				capturedOrigin = origin;
			});

			const handle = await documents.open('f1');
			handle.write('hello');

			expect(capturedOrigin).toBe(DOCUMENTS_ORIGIN);
		});

		test('non-transport remote update invokes onUpdate', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle = await documents.open('f1');

			// Apply a remote update with no origin (e.g., IndexedDB load)
			const remoteDoc = new Y.Doc({ guid: 'f1', gc: false });
			remoteDoc.getText('content').insert(0, 'remote edit');
			const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

			Y.applyUpdate(handle.ydoc, remoteUpdate);

			const result = tables.files.get('f1');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				expect(result.row.updatedAt).not.toBe(0);
			}

			remoteDoc.destroy();
		});

		test('transport-originated update does NOT invoke onUpdate', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle = await documents.open('f1');

			// Apply a remote update with a Symbol origin (simulating sync/broadcast)
			const FAKE_TRANSPORT = Symbol('fake-transport');
			const remoteDoc = new Y.Doc({ guid: 'f1', gc: false });
			remoteDoc.getText('content').insert(0, 'synced edit');
			const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

			Y.applyUpdate(handle.ydoc, remoteUpdate, FAKE_TRANSPORT);

			const result = tables.files.get('f1');
			expect(result.status).toBe('valid');
			if (result.status === 'valid') {
				// Transport-originated updates skip onUpdate — the originating
				// tab already bumped metadata via workspace sync.
				expect(result.row.updatedAt).toBe(0);
			}

			remoteDoc.destroy();
		});

	});
	describe('close', () => {
		test('document awareness is destroyed when document is closed', async () => {
			const { documents } = setup({
				awarenessDefinitions: {
					cursor: cursorSchema,
				},
			});

			const handle = await documents.open('f1');
			let destroyed = false;
			const originalDestroy = handle.awareness.raw.destroy.bind(
				handle.awareness.raw,
			);

			handle.awareness.raw.destroy = () => {
				destroyed = true;
				originalDestroy();
			};

			await documents.close('f1');
			expect(destroyed).toBe(true);
		});

		test('frees memory — doc can be re-opened as new instance', async () => {
			const { documents } = setup();

			const handle1 = await documents.open('f1');
			await documents.close('f1');

			const handle2 = await documents.open('f1');
			expect(handle2.ydoc).not.toBe(handle1.ydoc);
		});

		test('close on non-existent guid is a no-op', async () => {
			const { documents } = setup();

			// Should not throw
			await documents.close('nonexistent');
		});
	});

	describe('handle.extensions', () => {
		test('returns accumulated exports keyed by extension name', async () => {
			const { documents } = setup({
				documentExtensions: [
					{
						key: 'persistence',
						factory: () => ({
							clearLocalData: () => {},
							dispose: () => {},
						}),
					},
				],
			});

			const handle = await documents.open('f1');
			expect(handle.extensions).toBeDefined();
			expect(handle.extensions.persistence).toBeDefined();
			expect(typeof handle.extensions.persistence?.clearLocalData).toBe(
				'function',
			);
		});

		test('lifecycle-only extension is accessible with whenReady and dispose', async () => {
			const { documents } = setup({
				documentExtensions: [
					{
						key: 'lifecycle-only',
						factory: () => ({
							dispose: () => {},
						}),
					},
				],
			});

			const handle = await documents.open('f1');
			expect(handle.extensions).toBeDefined();
			const ext = handle.extensions['lifecycle-only'];
			expect(ext).toBeDefined();
			expect(ext?.whenReady).toBeInstanceOf(Promise);
			expect(typeof ext?.dispose).toBe('function');
		});

		test('accepts a row object', async () => {
			const { tables, documents } = setup({
				documentExtensions: [
					{
						key: 'test',
						factory: () => ({
							helper: () => 42,
						}),
					},
				],
			});

			const row = {
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			} as const;
			tables.files.set(row);

			const handle = await documents.open(row);
			expect(handle.extensions).toBeDefined();
			expect(typeof handle.extensions.test?.helper).toBe('function');
		});
	});

	describe('closeAll', () => {
		test('closes all open documents', async () => {
			const { documents } = setup();

			const handle1 = await documents.open('f1');
			const handle2 = await documents.open('f2');

			await documents.closeAll();

			// Re-opening should create new Y.Doc instances
			const handle1b = await documents.open('f1');
			const handle2b = await documents.open('f2');
			expect(handle1b.ydoc).not.toBe(handle1.ydoc);
			expect(handle2b.ydoc).not.toBe(handle2.ydoc);
		});
	});

	describe('row deletion', () => {
		test('deleting a row closes its open document', async () => {
			const { tables, documents } = setup();
			tables.files.set({
				id: 'f1',
				name: 'test.txt',
				updatedAt: 0,
				_v: 1,
			});

			const handle1 = await documents.open('f1');
			tables.files.delete('f1');

			// After deletion, re-opening should create a new Y.Doc
			const handle2 = await documents.open('f1');
			expect(handle2.ydoc).not.toBe(handle1.ydoc);
		});
	});
	describe('document extension hooks', () => {
		test('hooks are called in order', async () => {
			const order: number[] = [];

			const { documents } = setup({
				documentExtensions: [
					{
						key: 'first',
						factory: () => {
							order.push(1);
							return { dispose: () => {} };
						},
					},
					{
						key: 'second',
						factory: () => {
							order.push(2);
							return { dispose: () => {} };
						},
					},
					{
						key: 'third',
						factory: () => {
							order.push(3);
							return { dispose: () => {} };
						},
					},
				],
			});

			await documents.open('f1');
			expect(order).toEqual([1, 2, 3]);
		});

		test('second hook receives whenReady from first', async () => {
			let secondReceivedWhenReady = false;

			const { documents } = setup({
				documentExtensions: [
					{
						key: 'first',
						factory: () => ({
							whenReady: Promise.resolve(),
							dispose: () => {},
						}),
					},
					{
						key: 'second',
						factory: ({ whenReady }) => {
							secondReceivedWhenReady = whenReady instanceof Promise;
							return { dispose: () => {} };
						},
					},
				],
			});

			await documents.open('f1');
			expect(secondReceivedWhenReady).toBe(true);
		});

		test('hook returning void is skipped', async () => {
			let hooksCalled = 0;

			const { documents } = setup({
				documentExtensions: [
					{
						key: 'void-hook',
						factory: () => {
							hooksCalled++;
							return undefined; // void return
						},
					},
					{
						key: 'normal-hook',
						factory: () => {
							hooksCalled++;
							return { dispose: () => {} };
						},
					},
				],
			});

			await documents.open('f1');
			expect(hooksCalled).toBe(2);
		});

		test('no hooks → bare handle with Y.Doc, instant resolution', async () => {
			const { documents } = setup({ documentExtensions: [] });

			const handle = await documents.open('f1');
			expect(handle.ydoc).toBeInstanceOf(Y.Doc);
		});
	});

	describe('document extension whenReady and typed extensions', () => {
		test('document extension receives extensions map with flat exports', async () => {
			let capturedFirstExtension: unknown;

			const { documents } = setup({
				documentExtensions: [
					{
						key: 'first',
						factory: () => ({
							someValue: 42,
							dispose: () => {},
						}),
					},
					{
						key: 'second',
						factory: (context) => {
							capturedFirstExtension = context.extensions.first;
							return { dispose: () => {} };
						},
					},
				],
			});

			await documents.open('f1');
			expect(capturedFirstExtension).toBeDefined();
			expect(
				(capturedFirstExtension as Record<string, unknown>).someValue,
			).toBe(42);
		});

		test('document extension with no exports is still accessible', async () => {
			let firstExtensionSeen = false;

			const { documents } = setup({
				documentExtensions: [
					{
						key: 'first',
						factory: () => ({
							dispose: () => {},
						}),
					},
					{
						key: 'second',
						factory: (context) => {
							firstExtensionSeen = context.extensions.first !== undefined;
							return { dispose: () => {} };
						},
					},
				],
			});

			await documents.open('f1');
			expect(firstExtensionSeen).toBe(true);
		});

		test('handle.extensions includes flat exports from extensions', async () => {
			const { documents } = setup({
				documentExtensions: [
					{
						key: 'test',
						factory: () => ({
							helper: () => 42,
							dispose: () => {},
						}),
					},
				],
			});

			const handle = await documents.open('f1');
			expect(handle.extensions).toBeDefined();
			if (!handle.extensions.test) {
				throw new Error('Expected extensions for test extension');
			}
			expect(typeof handle.extensions.test.helper).toBe('function');
		});
	});

	describe('document awareness', () => {
		test('document handle has awareness with raw property', async () => {
			const filesTable = defineTable(
				type({ id: 'string', name: 'string', updatedAt: 'number', _v: '1' }),
			).withDocument('content', {
				guid: 'id',
				onUpdate: () => ({ updatedAt: Date.now() }),
				awareness: {
					cursor: cursorSchema,
				},
			});

			const client = createWorkspace({
				id: 'doc-awareness-typed-handle',
				tables: { files: filesTable },
			});

			const handle = await client.documents.files.content.open('f1');
			handle.awareness.setLocalField('cursor', { x: 3, y: 4 });

			const cursor = handle.awareness.getLocalField('cursor');
			const _typedCursor: { x: number; y: number } | undefined = cursor;
			void _typedCursor;

			// @ts-expect-error unknown awareness field should fail type-checking
			handle.awareness.setLocalField('presence', { online: true });

			expect(handle.awareness.raw).toBeInstanceOf(Awareness);
			expect(cursor).toEqual({ x: 3, y: 4 });
		});

		test('document awareness is independent per document', async () => {
			const filesTable = defineTable(
				type({ id: 'string', name: 'string', updatedAt: 'number', _v: '1' }),
			).withDocument('content', {
				guid: 'id',
				onUpdate: () => ({ updatedAt: Date.now() }),
				awareness: {
					cursor: cursorSchema,
				},
			});

			const client = createWorkspace({
				id: 'doc-awareness-isolated',
				tables: { files: filesTable },
			});

			const first = await client.documents.files.content.open('f1');
			const second = await client.documents.files.content.open('f2');

			first.awareness.setLocalField('cursor', { x: 7, y: 9 });

			expect(first.awareness.getLocalField('cursor')).toEqual({ x: 7, y: 9 });
			expect(second.awareness.getLocalField('cursor')).toBeUndefined();
		});
	});
});

// ════════════════════════════════════════════════════════════════════════════
// as*() conversion methods
// ════════════════════════════════════════════════════════════════════════════

describe('handle.asText / asRichText / asSheet', () => {
	function setupSimple() {
		const ydoc = new Y.Doc({ guid: 'workspace' });
		const tableDef = defineTable(
			type({ id: 'string', name: 'string', updatedAt: 'number', _v: '1' }),
		);
		const tables = createTables(ydoc, { files: tableDef });
		const documents = createDocuments({
			id: 'test-timeline',
			tableName: 'files',
			documentName: 'content',
			guidKey: 'id',
			onUpdate: () => ({ updatedAt: Date.now() }),
			tableHelper: tables.files,
			ydoc,
		});
		tables.files.set({ id: 'f1', name: 'test', updatedAt: 0, _v: 1 });
		return { documents, tables };
	}

	// ─── asText ────────────────────────────────────────────────────────

	test('asText on empty timeline auto-creates text entry', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		const text = handle.asText();
		expect(text).toBeInstanceOf(Y.Text);
		expect(handle.currentType).toBe('text');
	});

	test('asText on text entry returns existing Y.Text', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.write('hello');

		const text = handle.asText();
		expect(text.toString()).toBe('hello');
		expect(handle.length).toBe(1);
	});

	test('asText on richtext entry converts (lossy)', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		const fragment = handle.asRichText();
		const p = new Y.XmlElement('paragraph');
		const t = new Y.XmlText();
		t.insert(0, 'Rich content');
		p.insert(0, [t]);
		fragment.insert(0, [p]);

		expect(handle.currentType).toBe('richtext');

		const text = handle.asText();
		expect(text.toString()).toBe('Rich content');
		expect(handle.currentType).toBe('text');
		expect(handle.length).toBe(2);
	});

	test('asText on sheet entry converts to CSV', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		handle.write('Name,Age\nAlice,30\n');
		handle.asSheet();
		expect(handle.currentType).toBe('sheet');

		const text = handle.asText();
		expect(text.toString()).toBe('Name,Age\nAlice,30\n');
		expect(handle.currentType).toBe('text');
		expect(handle.length).toBe(3);
	});

	// ─── asRichText ────────────────────────────────────────────────────

	test('asRichText on empty timeline auto-creates richtext entry', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		const fragment = handle.asRichText();
		expect(fragment).toBeInstanceOf(Y.XmlFragment);
		expect(handle.currentType).toBe('richtext');
	});

	test('asRichText on richtext entry returns existing fragment', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.asRichText();

		const fragment = handle.asRichText();
		expect(fragment).toBeInstanceOf(Y.XmlFragment);
		expect(handle.length).toBe(1);
	});

	test('asRichText on text entry converts to paragraphs', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.write('Line 1\nLine 2');

		const fragment = handle.asRichText();
		expect(fragment).toBeInstanceOf(Y.XmlFragment);
		expect(handle.currentType).toBe('richtext');
		expect(handle.length).toBe(2);
		expect(handle.read()).toBe('Line 1\nLine 2');
	});

	test('asRichText on sheet entry converts CSV to paragraphs', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.write('A,B\n1,2\n');
		handle.asSheet();

		const fragment = handle.asRichText();
		expect(fragment).toBeInstanceOf(Y.XmlFragment);
		expect(handle.currentType).toBe('richtext');
		expect(handle.length).toBe(3);
	});

	// ─── asSheet ──────────────────────────────────────────────────────

	test('asSheet on empty timeline auto-creates sheet entry', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		const sheet = handle.asSheet();
		expect(sheet.columns).toBeInstanceOf(Y.Map);
		expect(sheet.rows).toBeInstanceOf(Y.Map);
		expect(handle.currentType).toBe('sheet');
	});

	test('asSheet on sheet entry returns existing binding', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.write('X,Y\n1,2\n');
		handle.asSheet();

		const sheet = handle.asSheet();
		expect(sheet.columns.size).toBe(2);
		expect(sheet.rows.size).toBe(1);
		expect(handle.length).toBe(2);
	});

	test('asSheet on text entry parses as CSV', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');
		handle.write('Col1,Col2\nA,B\n');

		const sheet = handle.asSheet();
		expect(sheet.columns.size).toBe(2);
		expect(sheet.rows.size).toBe(1);
		expect(handle.currentType).toBe('sheet');
		expect(handle.length).toBe(2);
	});

	test('asSheet on richtext entry extracts text then parses CSV', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		const fragment = handle.asRichText();
		const p1 = new Y.XmlElement('paragraph');
		const t1 = new Y.XmlText();
		t1.insert(0, 'Name,Age');
		p1.insert(0, [t1]);
		const p2 = new Y.XmlElement('paragraph');
		const t2 = new Y.XmlText();
		t2.insert(0, 'Alice,30');
		p2.insert(0, [t2]);
		fragment.insert(0, [p1, p2]);

		const sheet = handle.asSheet();
		expect(sheet.columns.size).toBe(2);
		expect(handle.currentType).toBe('sheet');
		expect(handle.length).toBe(2);
	});

	// ─── mode getter ──────────────────────────────────────────────────

	test('mode reflects current timeline state', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		expect(handle.currentType).toBeUndefined(); // empty
		handle.write('text');
		expect(handle.currentType).toBe('text');
	});

	// ─── consecutive conversions ──────────────────────────────────────

	test('consecutive conversions: text → richtext → sheet → text', async () => {
		const { documents } = setupSimple();
		const handle = await documents.open('f1');

		handle.write('hello');
		expect(handle.currentType).toBe('text');
		expect(handle.length).toBe(1);

		handle.asRichText();
		expect(handle.currentType).toBe('richtext');
		expect(handle.length).toBe(2);

		handle.asSheet();
		expect(handle.currentType).toBe('sheet');
		expect(handle.length).toBe(3);

		handle.asText();
		expect(handle.currentType).toBe('text');
		expect(handle.length).toBe(4);
	});
});
