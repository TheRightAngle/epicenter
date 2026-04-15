import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import type { MaybePromise, WhisperingError } from '$lib/result';

export const TextError = defineErrors({
	ClipboardRead: ({ cause }: { cause: unknown }) => ({
		message: `Failed to read from clipboard: ${extractErrorMessage(cause)}`,
		cause,
	}),
	ClipboardWrite: ({ cause }: { cause: unknown }) => ({
		message: `Failed to write to clipboard: ${extractErrorMessage(cause)}`,
		cause,
	}),
	WriteToCursor: ({ cause }: { cause: unknown }) => ({
		message: `Failed to write text at cursor position: ${extractErrorMessage(cause)}`,
		cause,
	}),
	SimulateKeystroke: ({ cause }: { cause: unknown }) => ({
		message: `Failed to simulate keystroke: ${extractErrorMessage(cause)}`,
		cause,
	}),
	NotSupported: ({ operation }: { operation: string }) => ({
		message: `${operation} is not supported in this environment for security reasons.`,
		operation,
	}),
});
export type TextError = InferErrors<typeof TextError>;

export type TextService = {
	/**
	 * Reads text from the system clipboard.
	 * @returns The text content of the clipboard, or null if empty.
	 */
	readFromClipboard: () => Promise<Result<string | null, TextError>>;

	/**
	 * Copies text to the system clipboard.
	 * @param text The text to copy to the clipboard.
	 */
	copyToClipboard: (text: string) => Promise<Result<void, TextError>>;

	/**
	 * Writes the provided text at the current cursor position.
	 * Uses the clipboard sandwich technique to preserve the user's existing clipboard content.
	 *
	 * This method:
	 * 1. Saves the current clipboard
	 * 2. Writes the text to clipboard
	 * 3. Simulates paste (Cmd+V on macOS, Ctrl+V elsewhere)
	 * 4. Restores the original clipboard
	 *
	 * @param text The text to write at the cursor position.
	 */
	writeToCursor: (
		text: string,
		options?: { preserveClipboard?: boolean },
	) => MaybePromise<Result<void, TextError | WhisperingError>>;

	/**
	 * Simulates pressing the Enter/Return key.
	 * Useful for automatically submitting text in chat applications after transcription.
	 *
	 * Note: This is only supported on desktop (Tauri). Web browsers cannot simulate keystrokes
	 * for security reasons.
	 */
	simulateEnterKeystroke: () => Promise<Result<void, TextError>>;

	/**
	 * Simulates pressing the Space key.
	 * Useful for leaving a trailing space at the cursor so successive
	 * push-to-talk transcriptions don't run together.
	 *
	 * Note: This is only supported on desktop (Tauri). Web browsers cannot simulate keystrokes
	 * for security reasons.
	 */
	simulateSpaceKeystroke: () => Promise<Result<void, TextError>>;
};
