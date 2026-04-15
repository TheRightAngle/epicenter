import type { InferKvValue } from '@epicenter/workspace';
import { SvelteMap } from 'svelte/reactivity';
import { workspace } from '$lib/client';
import {
	DEVICE_CONFIG_KEYS,
	deviceConfig,
	type DeviceConfigKey,
	type InferDeviceValue,
} from '$lib/state/device-config.svelte';

const KV_DEFINITIONS = workspace.definitions.kv;
type KvKey = keyof typeof KV_DEFINITIONS & string;
type KvDefs = typeof KV_DEFINITIONS;

/**
 * Union of every known setting key — KV (workspace-synced) or device-bound.
 * Lets `settings.get`/`settings.set` infer the correct return type for either
 * namespace without the caller having to know which side a key lives on.
 */
type AnySettingKey = KvKey | DeviceConfigKey;

type InferSettingValue<K extends AnySettingKey> = K extends KvKey
	? InferKvValue<KvDefs[K]>
	: K extends DeviceConfigKey
		? InferDeviceValue<K>
		: never;

/**
 * Legacy `settings.value['key']` accessor shape — maps every known key to
 * its typed value. The proxy itself still accepts arbitrary string reads (for
 * legacy fork code that still uses old key names); unknown keys fall through
 * to `unknown` via the runtime `canonicalKey` lookup.
 */
type SettingsValueMap = {
	[K in AnySettingKey]: InferSettingValue<K>;
} & {
	[K in LegacyKey]: (typeof LEGACY_KEY_MAP)[K] extends AnySettingKey
		? InferSettingValue<(typeof LEGACY_KEY_MAP)[K]>
		: unknown;
};

/**
 * Legacy fork key → canonical upstream key.
 *
 * Upstream renamed many settings keys during the unified-settings deletion
 * refactor. Our fork's call sites still use the old names; this table
 * translates them transparently on read/write so the fork code keeps working
 * without per-call-site migration.
 */
const LEGACY_KEY_MAP = {
	'sound.playOn.manual-start': 'sound.manualStart',
	'sound.playOn.manual-stop': 'sound.manualStop',
	'sound.playOn.manual-cancel': 'sound.manualCancel',
	'sound.playOn.vad-start': 'sound.vadStart',
	'sound.playOn.vad-capture': 'sound.vadCapture',
	'sound.playOn.vad-stop': 'sound.vadStop',
	'sound.playOn.transcriptionComplete': 'sound.transcriptionComplete',
	'sound.playOn.transformationComplete': 'sound.transformationComplete',
	'transcription.copyToClipboardOnSuccess': 'output.transcription.clipboard',
	'transcription.writeToCursorOnSuccess': 'output.transcription.cursor',
	'transcription.simulateEnterAfterOutput': 'output.transcription.enter',
	'transformation.copyToClipboardOnSuccess': 'output.transformation.clipboard',
	'transformation.writeToCursorOnSuccess': 'output.transformation.cursor',
	'transformation.simulateEnterAfterOutput': 'output.transformation.enter',
	'system.alwaysOnTop': 'ui.alwaysOnTop',
	'database.recordingRetentionStrategy': 'retention.strategy',
	'database.maxRecordingCount': 'retention.maxCount',
	'transcription.selectedTranscriptionService': 'transcription.service',
	'transcription.outputLanguage': 'transcription.language',
	'transformations.selectedTransformationId': 'transformation.selectedId',
	'completion.openrouter.model': 'transformation.openrouterModel',
	'shortcuts.local.toggleManualRecording': 'shortcut.toggleManualRecording',
	'shortcuts.local.startManualRecording': 'shortcut.startManualRecording',
	'shortcuts.local.stopManualRecording': 'shortcut.stopManualRecording',
	'shortcuts.local.cancelManualRecording': 'shortcut.cancelManualRecording',
	'shortcuts.local.toggleVadRecording': 'shortcut.toggleVadRecording',
	'shortcuts.local.startVadRecording': 'shortcut.startVadRecording',
	'shortcuts.local.stopVadRecording': 'shortcut.stopVadRecording',
	'shortcuts.local.pushToTalk': 'shortcut.pushToTalk',
	'shortcuts.local.openTransformationPicker': 'shortcut.openTransformationPicker',
	'shortcuts.local.runTransformationOnClipboard':
		'shortcut.runTransformationOnClipboard',
	// CPAL buffered capture dropped the "experimental" prefix once the
	// channel-based writer pipeline shipped — the flag is now orthogonal
	// to hot-path performance, so it no longer needs the scary name.
	'recording.cpal.experimentalBufferedCapture': 'recording.cpal.bufferedCapture',
} as const satisfies Record<string, AnySettingKey>;

type LegacyKey = keyof typeof LEGACY_KEY_MAP;

function canonicalKey(key: string): string {
	return (LEGACY_KEY_MAP as Record<string, string>)[key] ?? key;
}

function isKvKey(key: string): key is KvKey {
	return key in KV_DEFINITIONS;
}

function isDeviceKey(key: string): boolean {
	return DEVICE_CONFIG_KEYS.has(key);
}

function createSettings() {
	const map = new SvelteMap<string, unknown>();

	for (const key of Object.keys(KV_DEFINITIONS) as KvKey[]) {
		map.set(key, workspace.kv.get(key));
	}

	workspace.kv.observeAll((changes) => {
		for (const [key, change] of changes) {
			if (change.type === 'set') {
				map.set(key, change.value);
			} else if (change.type === 'delete') {
				map.set(key, workspace.kv.get(key));
			}
		}
	});

	/**
	 * Keys that cross a string↔number type boundary between the legacy
	 * fork settings schema (dominated by `string.digits`) and upstream's
	 * workspace.kv schema (uses `number.integer`).
	 *
	 * Writes always coerce string → number so arktype doesn't reject.
	 * Reads only stringify on the legacy `settings.value[key]` proxy
	 * path — never on the modern `settings.get(key)` path. The modern
	 * API returns the native type straight from storage so UI
	 * components (dropdowns, `$derived` comparisons against numeric
	 * catalog entries) see the real number and match correctly.
	 */
	const NUMERIC_KV_KEYS = new Set<string>([
		'retention.maxCount',
		// Upstream stores temperature as `0 <= number <= 1` while the fork's
		// old schema typed it as a string. No current fork code reads it
		// through the legacy proxy, but listing it here keeps the shim
		// consistent with workspace/definition.ts and guards future callers.
		'transcription.temperature',
	]);

	function readValue(rawKey: string): unknown {
		const key = canonicalKey(rawKey);
		if (isKvKey(key)) return map.get(key);
		if (isDeviceKey(key)) return deviceConfig.get(key as never);
		return undefined;
	}

	function writeValue(rawKey: string, value: unknown): void {
		const key = canonicalKey(rawKey);
		if (isKvKey(key)) {
			let coerced = value;
			// Fork UI writes a string; upstream schema is number. Parse
			// before hitting arktype so `type('number.integer >= 0')`
			// doesn't reject and silently revert to the default.
			if (NUMERIC_KV_KEYS.has(key) && typeof value === 'string') {
				const parsed = Number.parseInt(value, 10);
				if (Number.isFinite(parsed)) coerced = parsed;
			}
			workspace.kv.set(key, coerced as never);
			return;
		}
		if (isDeviceKey(key)) {
			deviceConfig.set(key as never, value as never);
		}
	}

	/**
	 * Proxy that emulates the fork's legacy `settings.value[key]` read/write API.
	 * Only this path stringifies numeric KV values for backwards compat with
	 * fork-era callers that compare strings; modern `settings.get(k)` returns
	 * native types.
	 */
	const valueProxy = new Proxy({} as Record<string, unknown>, {
		get: (_target, prop) => {
			if (typeof prop !== 'string') return undefined;
			const value = readValue(prop);
			if (
				NUMERIC_KV_KEYS.has(canonicalKey(prop)) &&
				typeof value === 'number'
			) {
				return String(value);
			}
			return value;
		},
		set: (_target, prop, value) => {
			if (typeof prop !== 'string') return false;
			writeValue(prop, value);
			return true;
		},
	});

	return {
		/**
		 * Get a setting value. Accepts any KV or device-config key and returns
		 * the precisely-typed value for it. Legacy fork-era key names still work
		 * at runtime (via canonicalKey), but only canonical keys get typed.
		 */
		get<K extends AnySettingKey>(key: K): InferSettingValue<K> {
			return readValue(key) as InferSettingValue<K>;
		},

		/**
		 * Set a setting value. Writes go to workspace.kv or deviceConfig
		 * depending on whether the key is synced or device-bound.
		 */
		set<K extends AnySettingKey>(
			key: K,
			value: InferSettingValue<K>,
		) {
			writeValue(key, value);
		},

		/**
		 * Reset all workspace settings to their default values.
		 */
		reset() {
			for (const key of Object.keys(KV_DEFINITIONS) as KvKey[]) {
				workspace.kv.set(key, KV_DEFINITIONS[key].defaultValue);
			}
		},

		/**
		 * Legacy fork API — preserved for backwards compatibility with the
		 * ~60 call sites that still use `settings.value[key]` and
		 * `settings.updateKey(key, value)`. New code should prefer `get`/`set`.
		 *
		 * Typed as `SettingsValueMap` so `settings.value['some.key']` returns
		 * the correct narrowed type for known keys. Unknown keys still work at
		 * runtime via the proxy; callers that need truly-arbitrary string reads
		 * can cast through `as unknown as Record<string, unknown>`.
		 */
		get value(): SettingsValueMap {
			return valueProxy as unknown as SettingsValueMap;
		},

		updateKey: ((key: string, value: unknown): void => {
			writeValue(key, value);
		}) as {
			<K extends AnySettingKey>(key: K, value: InferSettingValue<K>): void;
			(key: string, value: unknown): void;
		},
	};
}

export const settings = createSettings();
