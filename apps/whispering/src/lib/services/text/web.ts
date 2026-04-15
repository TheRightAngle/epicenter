import { Ok, tryAsync } from 'wellcrafted/result';
import type { TextService } from './types';
import { TextError } from './types';

export function createTextServiceWeb(): TextService {
	return {
		readFromClipboard: () =>
			tryAsync({
				try: async () => {
					const text = await navigator.clipboard.readText();
					return text || null;
				},
				catch: (error) => TextError.ClipboardRead({ cause: error }),
			}),

		copyToClipboard: async (text) => {
			const { error: copyError } = await tryAsync({
				try: () => navigator.clipboard.writeText(text),
				catch: (error) => TextError.ClipboardWrite({ cause: error }),
			});

			if (copyError) {
				// Extension fallback code commented out for now
				// Could be re-enabled if extension support is needed
				return Ok(undefined);
			}
			return Ok(undefined);
		},

		writeToCursor: async (text) => {
			// In web browsers, we cannot programmatically paste for security reasons
			// We can copy the text to clipboard but the user must manually paste with Cmd/Ctrl+V
			await navigator.clipboard.writeText(text);
			return TextError.NotSupported({
				operation: 'Automatic paste',
			});
		},

		simulateEnterKeystroke: async () =>
			TextError.NotSupported({
				operation: 'Simulating keystrokes',
			}),

		simulateSpaceKeystroke: async () =>
			TextError.NotSupported({
				operation: 'Simulating keystrokes',
			}),
	};
}
