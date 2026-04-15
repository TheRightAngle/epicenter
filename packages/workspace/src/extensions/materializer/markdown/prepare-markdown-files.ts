import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateId } from '../../../shared/id.js';
import { toMarkdown } from './markdown.js';
import { parseMarkdownFile } from './parse-markdown-file.js';

type PrepareResult = {
	prepared: number;
	skipped: number;
	errors: string[];
};

/**
 * Walk a directory of `.md` files and ensure each has a unique `id` in its
 * YAML frontmatter. Files that already have an `id` are left untouched.
 * Files without one get a generated nanoid written back.
 *
 * **Duplicate check**: Before any writes, the function scans every file. If
 * two or more files share the same `id`, it returns an error listing every
 * conflict and modifies nothing.
 *
 * Only reads top-level `.md` files—does not recurse into subdirectories.
 *
 * @example
 * ```typescript
 * const result = await prepareMarkdownFiles('./my-vault');
 * if (result.errors.length > 0) {
 *   console.error('Conflicts:', result.errors);
 * } else {
 *   console.log(`Prepared ${result.prepared}, skipped ${result.skipped}`);
 * }
 * ```
 */
export async function prepareMarkdownFiles(
	directory: string,
): Promise<PrepareResult> {
	const entries = await readdir(directory);
	const mdFiles = entries.filter((f) => f.endsWith('.md'));

	// First pass: parse all files and collect existing IDs
	const idToFiles = new Map<string, string[]>();
	const filesToPrepare: {
		filename: string;
		frontmatter: Record<string, unknown>;
		body: string | undefined;
	}[] = [];
	let skipped = 0;

	for (const filename of mdFiles) {
		const filePath = join(directory, filename);
		const content = await readFile(filePath, 'utf-8');
		const parsed = parseMarkdownFile(content);

		// Skip files without valid frontmatter
		if (!parsed) {
			skipped++;
			continue;
		}

		const { frontmatter, body } = parsed;
		const existingId = frontmatter.id;

		if (typeof existingId === 'string' && existingId.length > 0) {
			// Track existing IDs for duplicate detection
			const existing = idToFiles.get(existingId) ?? [];
			existing.push(filename);
			idToFiles.set(existingId, existing);
			skipped++;
		} else {
			filesToPrepare.push({ filename, frontmatter, body });
		}
	}

	// Check for duplicate IDs before modifying anything
	const errors: string[] = [];
	for (const [id, files] of idToFiles) {
		if (files.length > 1) {
			errors.push(`Duplicate id "${id}" found in: ${files.join(', ')}`);
		}
	}

	if (errors.length > 0) {
		return { prepared: 0, skipped, errors };
	}

	// Second pass: generate IDs and write back
	for (const { filename, frontmatter, body } of filesToPrepare) {
		const filePath = join(directory, filename);
		const newId = generateId();
		const updatedFrontmatter = { id: newId, ...frontmatter };
		const markdown = toMarkdown(updatedFrontmatter, body);
		await writeFile(filePath, markdown, 'utf-8');
	}

	return { prepared: filesToPrepare.length, skipped, errors: [] };
}
