import { defineMutation, defineQuery } from '$lib/query/client';
import { services } from '$lib/services';

const textKeys = {
	clipboard: ['text', 'clipboard'] as const,
	readFromClipboard: ['text', 'readFromClipboard'] as const,
	copyToClipboard: ['text', 'copyToClipboard'] as const,
	writeToCursor: ['text', 'writeToCursor'] as const,
	simulateEnterKeystroke: ['text', 'simulateEnterKeystroke'] as const,
} as const;

export const text = {
	readFromClipboard: defineQuery({
		queryKey: textKeys.readFromClipboard,
		queryFn: () => services.text.readFromClipboard(),
	}),
	copyToClipboard: defineMutation({
		mutationKey: ['text', 'copyToClipboard'],
		mutationFn: ({ text }: { text: string }) =>
			services.text.copyToClipboard(text),
	}),
	writeToCursor: defineMutation({
		mutationKey: textKeys.writeToCursor,
		mutationFn: async ({
			text,
			preserveClipboard,
		}: {
			text: string;
			preserveClipboard?: boolean;
		}) => {
			// writeToCursor handles everything internally:
			// 1. Writes text to clipboard
			// 2. Simulates paste
			// 3. Optionally restores the prior clipboard
			return await services.text.writeToCursor(text, { preserveClipboard });
		},
	}),
	simulateEnterKeystroke: defineMutation({
		mutationKey: textKeys.simulateEnterKeystroke,
		mutationFn: () => services.text.simulateEnterKeystroke(),
	}),
};
