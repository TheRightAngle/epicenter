import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const isRegisteredMock = mock<any>(async () => false);
const registerMock = mock<any>(async () => undefined);
const unregisterMock = mock<any>(async () => undefined);
const unregisterAllMock = mock<any>(async () => undefined);

async function loadGlobalShortcutManager() {
	return await import('./global-shortcut-manager');
}

beforeEach(() => {
	mock.restore();
	isRegisteredMock.mockReset();
	registerMock.mockReset();
	unregisterMock.mockReset();
	unregisterAllMock.mockReset();

	isRegisteredMock.mockResolvedValue(false);
	registerMock.mockResolvedValue(undefined);
	unregisterMock.mockResolvedValue(undefined);
	unregisterAllMock.mockResolvedValue(undefined);

	mock.module('@tauri-apps/plugin-global-shortcut', () => ({
		isRegistered: isRegisteredMock,
		register: registerMock,
		unregister: unregisterMock,
		unregisterAll: unregisterAllMock,
	}));

	mock.module('@tauri-apps/plugin-os', () => ({
		type: () => 'windows',
	}));

	mock.module('$lib/constants/keyboard', () => ({
		ACCELERATOR_KEY_CODES: ['P'],
		ACCELERATOR_MODIFIER_KEYS: ['Control', 'Shift', 'Alt', 'Meta'],
		ACCELERATOR_MODIFIER_SORT_PRIORITY: {
			Control: 1,
			Shift: 2,
			Alt: 3,
			Meta: 4,
		},
		ACCELERATOR_PUNCTUATION_KEYS: [],
		FUNCTION_KEY_PATTERN: /^F\d+$/,
		KEYBOARD_EVENT_SPECIAL_KEY_TO_ACCELERATOR_KEY_CODE_MAP: {},
	}));
});

afterEach(() => {
	mock.restore();
});

describe('GlobalShortcutManagerLive.register', () => {
	test('returns the real register error when the shortcut never actually registers', async () => {
		isRegisteredMock
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);
		registerMock.mockRejectedValue(new Error('RegisterEventHotKey failed'));

		const { GlobalShortcutManagerLive } = await loadGlobalShortcutManager();
		const result = await GlobalShortcutManagerLive.register({
			accelerator: 'Control+P' as never,
			callback: () => undefined,
			on: ['Pressed'],
		});

		expect(result.error?.name).toBe('RegisterFailed');
		expect(result.error?.message).toContain('RegisterEventHotKey failed');
		expect(isRegisteredMock).toHaveBeenCalledTimes(2);
	});

	test('treats false-positive register errors as success when the shortcut reports registered', async () => {
		isRegisteredMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		registerMock.mockRejectedValue(new Error('RegisterEventHotKey failed'));

		const { GlobalShortcutManagerLive } = await loadGlobalShortcutManager();
		const result = await GlobalShortcutManagerLive.register({
			accelerator: 'Control+P' as never,
			callback: () => undefined,
			on: ['Pressed'],
		});

		expect(result.error).toBeNull();
		expect(isRegisteredMock).toHaveBeenCalledTimes(2);
	});

	test('surfaces the original register failure when the follow-up registration check also fails', async () => {
		isRegisteredMock
			.mockResolvedValueOnce(false)
			.mockRejectedValueOnce(new Error('status check failed'));
		registerMock.mockRejectedValue(new Error('RegisterEventHotKey failed'));

		const { GlobalShortcutManagerLive } = await loadGlobalShortcutManager();
		const result = await GlobalShortcutManagerLive.register({
			accelerator: 'Control+P' as never,
			callback: () => undefined,
			on: ['Pressed'],
		});

		expect(result.error?.name).toBe('RegisterFailed');
		expect(result.error?.message).toContain('RegisterEventHotKey failed');
	});
});
