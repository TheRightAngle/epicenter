import { readFileSync, readSync } from 'node:fs';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Err, type Result, trySync } from 'wellcrafted/result';

export type ParseInputOptions = {
	/** Positional argument (inline JSON or @file) */
	positional?: string;
	/** --file flag value */
	file?: string;
	/** Whether stdin has data (process.stdin.isTTY === false) */
	hasStdin?: boolean;
	/** Stdin content (if hasStdin) */
	stdinContent?: string;
};

const ParseInputError = defineErrors({
	InvalidJson: ({ cause }: { cause: unknown }) => ({
		message: `Invalid JSON: ${extractErrorMessage(cause)}`,
		cause,
	}),
	FileNotFound: ({ path }: { path: string }) => ({
		message: `File not found: ${path}`,
		path,
	}),
	FileReadFailed: ({ path, cause }: { path: string; cause: unknown }) => ({
		message: `Error reading file '${path}': ${extractErrorMessage(cause)}`,
		path,
		cause,
	}),
	NoInputProvided: () => ({
		message:
			'No input provided. Use inline JSON, --file, @file, or pipe via stdin.',
	}),
});
type ParseInputError = InferErrors<typeof ParseInputError>;

function parseJson<T>(input: string): Result<T, ParseInputError> {
	return trySync({
		try: () => JSON.parse(input) as T,
		catch: (error) => ParseInputError.InvalidJson({ cause: error }),
	});
}

function readJsonFile<T>(filePath: string): Result<T, ParseInputError> {
	const { data: content, error: readError } = trySync({
		try: () => readFileSync(filePath, 'utf-8'),
		catch: (error) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return ParseInputError.FileNotFound({ path: filePath });
			}
			return ParseInputError.FileReadFailed({
				path: filePath,
				cause: error,
			});
		},
	});

	if (readError) return Err(readError);

	return parseJson<T>(content);
}

/**
 * Parse JSON input from various sources.
 * Priority: positional > --file > stdin
 */
export function parseJsonInput<T = unknown>(
	options: ParseInputOptions,
): Result<T, ParseInputError> {
	// 1. Check positional (could be inline JSON or @file)
	if (options.positional) {
		if (options.positional.startsWith('@')) {
			const filePath = options.positional.slice(1);
			return readJsonFile<T>(filePath);
		}
		return parseJson<T>(options.positional);
	}

	// 2. Check --file flag
	if (options.file) {
		return readJsonFile<T>(options.file);
	}

	// 3. Check stdin
	if (options.hasStdin && options.stdinContent) {
		return parseJson<T>(options.stdinContent);
	}

	return ParseInputError.NoInputProvided();
}

/**
 * Read stdin content synchronously (for CLI use).
 * Returns undefined if stdin is a TTY (interactive).
 */
export function readStdinSync(): string | undefined {
	if (process.stdin.isTTY) return undefined;

	try {
		const chunks: Buffer[] = [];
		const fd = 0; // stdin file descriptor
		const buf = Buffer.alloc(1024);
		let bytesRead: number;

		// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic read loop
		while ((bytesRead = readSync(fd, buf, 0, buf.length, null)) > 0) {
			chunks.push(buf.subarray(0, bytesRead));
		}

		return Buffer.concat(chunks).toString('utf-8').trim() || undefined;
	} catch {
		return undefined;
	}
}
