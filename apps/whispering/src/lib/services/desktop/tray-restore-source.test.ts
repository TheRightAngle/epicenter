import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Tray window restore wiring', () => {
	test('restores the main window from the tray with focus and uses it for tray actions', () => {
		const source = readFileSync(new URL('./tray.ts', import.meta.url), 'utf8');

		expect(source).toContain('export async function restoreWindowFromTray(');
		expect(source).toContain('await currentWindow.show();');
		expect(source).toContain('await currentWindow.unminimize();');
		expect(source).toContain('await currentWindow.setFocus();');
		expect(source).toContain("text: 'Show Window'");
		expect(source).toContain('return restoreWindowFromTray();');
		expect(source).toContain('void restoreWindowFromTray();');
	});
});
