import { describe, expect, test } from 'bun:test';

describe('toast visibility', () => {
	test('shows only warning and error toasts in important-only mode', async () => {
		const module = await import('./toast-visibility').catch(() => null);

		expect(module?.shouldShowToast('important-only', 'error')).toBe(true);
		expect(module?.shouldShowToast('important-only', 'warning')).toBe(true);
		expect(module?.shouldShowToast('important-only', 'success')).toBe(false);
		expect(module?.shouldShowToast('important-only', 'info')).toBe(false);
		expect(module?.shouldShowToast('important-only', 'loading')).toBe(false);
	});

	test('suppresses all in-app toasts in off mode', async () => {
		const module = await import('./toast-visibility').catch(() => null);

		expect(module?.shouldShowToast('off', 'error')).toBe(false);
		expect(module?.shouldShowToast('off', 'warning')).toBe(false);
		expect(module?.shouldShowToast('off', 'success')).toBe(false);
	});
});
