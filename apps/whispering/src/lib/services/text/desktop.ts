import { invoke } from '@tauri-apps/api/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { tryAsync } from 'wellcrafted/result';
import type { TextService } from './types';
import { TextError } from './types';

export function createTextServiceDesktop(): TextService {
	return {
		readFromClipboard: () =>
			tryAsync({
				try: async () => {
					const text = await readText();
					return text ?? null;
				},
				catch: (error) => TextError.ClipboardRead({ cause: error }),
			}),

		copyToClipboard: (text) =>
			tryAsync({
				try: () => writeText(text),
				catch: (error) => TextError.ClipboardWrite({ cause: error }),
			}),

		writeToCursor: async (text, options) =>
			tryAsync({
				try: () =>
					invoke<void>(
						options?.preserveClipboard === false
							? 'write_text_fast'
							: 'write_text',
						{ text },
					),
				catch: (error) => TextError.WriteToCursor({ cause: error }),
			}),

		simulateEnterKeystroke: () =>
			tryAsync({
				try: () => invoke<void>('simulate_enter_keystroke'),
				catch: (error) => TextError.SimulateKeystroke({ cause: error }),
			}),

		simulateSpaceKeystroke: () =>
			tryAsync({
				try: () => invoke<void>('simulate_space_keystroke'),
				catch: (error) => TextError.SimulateKeystroke({ cause: error }),
			}),
	};
}
