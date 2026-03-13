import { basename } from '@tauri-apps/api/path';
import { exists, readFile, remove } from '@tauri-apps/plugin-fs';
import mime from 'mime';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { tryAsync } from 'wellcrafted/result';

export const FsError = defineErrors({
	ReadBlobFailed: ({ path, cause }: { path: string; cause: unknown }) => ({
		message: `Failed to read file as Blob: ${path}: ${extractErrorMessage(cause)}`,
		path,
		cause,
	}),
	ReadFileFailed: ({ path, cause }: { path: string; cause: unknown }) => ({
		message: `Failed to read file as File: ${path}: ${extractErrorMessage(cause)}`,
		path,
		cause,
	}),
	ReadFilesFailed: ({ paths, cause }: { paths: string[]; cause: unknown }) => ({
		message: `Failed to read files: ${paths.join(', ')}: ${extractErrorMessage(cause)}`,
		paths,
		cause,
	}),
	DeletePathFailed: ({ path, cause }: { path: string; cause: unknown }) => ({
		message: `Failed to delete file: ${path}: ${extractErrorMessage(cause)}`,
		path,
		cause,
	}),
});
export type FsError = InferErrors<typeof FsError>;

export const FsServiceLive = {
	/**
	 * Reads a file from disk and creates a Blob with the correct MIME type.
	 * @param path - The file path to read
	 */
	pathToBlob: (path: string) =>
		tryAsync({
			try: () => createBlobFromPath(path),
			catch: (error) => FsError.ReadBlobFailed({ path, cause: error }),
		}),

	/**
	 * Reads a file from disk and creates a File object with the correct MIME type.
	 * @param path - The file path to read
	 */
	pathToFile: (path: string) =>
		tryAsync({
			try: () => createFileFromPath(path),
			catch: (error) => FsError.ReadFileFailed({ path, cause: error }),
		}),

	/**
	 * Reads multiple files from disk and creates File objects with correct MIME types.
	 * @param paths - Array of file paths to read
	 */
	pathsToFiles: (paths: string[]) =>
		tryAsync({
			try: () => Promise.all(paths.map(createFileFromPath)),
			catch: (error) => FsError.ReadFilesFailed({ paths, cause: error }),
		}),

	deletePath: (path: string) =>
		tryAsync({
			try: async () => {
				if (await exists(path)) {
					await remove(path);
				}
			},
			catch: (error) => FsError.DeletePathFailed({ path, cause: error }),
		}),
};

export type FsService = typeof FsServiceLive;

/** Reads a file from disk and creates a Blob with the correct MIME type. */
async function createBlobFromPath(path: string): Promise<Blob> {
	const { bytes, mimeType } = await readFileWithMimeType(path);
	return new Blob([bytes], { type: mimeType });
}

/** Reads a file from disk and creates a File object with the correct MIME type. */
async function createFileFromPath(path: string): Promise<File> {
	const { bytes, mimeType } = await readFileWithMimeType(path);
	const fileName = await basename(path);
	return new File([bytes], fileName, { type: mimeType });
}

/**
 * Reads a file and returns its bytes with the correct type for Blob/File constructors,
 * along with the inferred MIME type.
 *
 * Tauri's readFile always returns ArrayBuffer-backed Uint8Array, never SharedArrayBuffer,
 * so the cast is safe.
 */
async function readFileWithMimeType(path: string): Promise<{
	bytes: Uint8Array<ArrayBuffer>;
	mimeType: string;
}> {
	// Cast is safe: Tauri's readFile always returns ArrayBuffer-backed Uint8Array, never SharedArrayBuffer
	const bytes = (await readFile(path)) as Uint8Array<ArrayBuffer>;
	const mimeType = mime.getType(path) ?? 'application/octet-stream';
	return { bytes, mimeType };
}
