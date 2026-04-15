/**
 * prepareMarkdownFiles Tests
 *
 * Verifies the `prepareMarkdownFiles` utility that walks a directory of `.md`
 * files and ensures each has a unique `id` in its YAML frontmatter. Files
 * without an `id` get one generated; files with duplicate IDs trigger an error
 * with zero modifications.
 *
 * Key behaviors:
 * - Files without `id` get one added to frontmatter
 * - Files with existing `id` are left untouched
 * - Duplicate IDs produce an error with no file modifications
 * - Non-`.md` files are ignored
 * - Files without valid frontmatter are skipped
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarkdownFile } from './parse-markdown-file';
import { prepareMarkdownFiles } from './prepare-markdown-files';

const TEST_DIR = join(import.meta.dir, '__test-prepare__');

beforeEach(async () => {
	await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
	await rm(TEST_DIR, { recursive: true, force: true });
});

function writeTestFile(name: string, content: string) {
	return writeFile(join(TEST_DIR, name), content, 'utf-8');
}

function readTestFile(name: string) {
	return readFile(join(TEST_DIR, name), 'utf-8');
}

describe('prepareMarkdownFiles', () => {
	test('files without id get one added', async () => {
		await writeTestFile('note.md', '---\ntitle: Hello\n---\n\nBody text\n');

		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);

		const content = await readTestFile('note.md');
		const parsed = parseMarkdownFile(content);
		expect(parsed).not.toBeNull();
		expect(typeof parsed!.frontmatter.id).toBe('string');
		expect((parsed!.frontmatter.id as string).length).toBeGreaterThan(0);
		expect(parsed!.frontmatter.title).toBe('Hello');
		expect(parsed!.body).toBe('Body text');
	});

	test('files with existing id are skipped', async () => {
		const original = '---\nid: existing-id-123\ntitle: Hello\n---\n\nBody\n';
		await writeTestFile('note.md', original);

		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);

		// File should be unmodified
		const content = await readTestFile('note.md');
		expect(content).toBe(original);
	});

	test('duplicate ids produce an error with no file modifications', async () => {
		await writeTestFile('a.md', '---\nid: duplicate-id\ntitle: First\n---\n');
		await writeTestFile('b.md', '---\nid: duplicate-id\ntitle: Second\n---\n');
		await writeTestFile('c.md', '---\ntitle: No ID\n---\n');

		const originalC = await readTestFile('c.md');
		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(0);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0]).toContain('duplicate-id');
		expect(result.errors[0]).toContain('a.md');
		expect(result.errors[0]).toContain('b.md');

		// c.md should NOT have been modified despite missing an id
		const contentC = await readTestFile('c.md');
		expect(contentC).toBe(originalC);
	});

	test('non-.md files are ignored', async () => {
		await writeTestFile('readme.txt', '---\ntitle: Hello\n---\n');
		await writeTestFile('data.json', '{"id": "test"}');
		await writeTestFile('note.md', '---\ntitle: Note\n---\n');

		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(1);
		expect(result.skipped).toBe(0);
		// Only the .md file was processed
	});

	test('files without frontmatter are skipped', async () => {
		await writeTestFile('plain.md', '# Just a heading\n\nSome content\n');
		await writeTestFile('note.md', '---\ntitle: Note\n---\n');

		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(1);
		expect(result.skipped).toBe(1);

		// plain.md should be unmodified
		const content = await readTestFile('plain.md');
		expect(content).toBe('# Just a heading\n\nSome content\n');
	});

	test('mixed files: some with id, some without, all valid', async () => {
		await writeTestFile('has-id.md', '---\nid: abc123\ntitle: Existing\n---\n');
		await writeTestFile('no-id.md', '---\ntitle: New\n---\n\nBody\n');

		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);

		// The file that had an id should be untouched
		const hasIdContent = await readTestFile('has-id.md');
		expect(hasIdContent).toBe('---\nid: abc123\ntitle: Existing\n---\n');

		// The file without id should now have one
		const noIdContent = await readTestFile('no-id.md');
		const parsed = parseMarkdownFile(noIdContent);
		expect(parsed).not.toBeNull();
		expect(typeof parsed!.frontmatter.id).toBe('string');
	});

	test('empty directory returns zero counts', async () => {
		const result = await prepareMarkdownFiles(TEST_DIR);

		expect(result.prepared).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
	});
});
