import type { InferKvValue } from '@epicenter/workspace';
import { SvelteMap } from 'svelte/reactivity';
import { workspace } from '$lib/client';
import {
	DEVICE_CONFIG_KEYS,
	deviceConfig,
} from '$lib/state/device-config.svelte';

const KV_DEFINITIONS = workspace.definitions.kv;
type KvKey = keyof typeof KV_DEFINITIONS & string;
type KvDefs = typeof KV_DEFINITIONS;

/**
 * Legacy fork key → canonical upstream key.
 *
 * Upstream renamed many settings keys during the unified-settings deletion
 * refactor. Our fork's call sites still use the old names; this table
 * translates them transparently on read/write so the fork code keeps working
 * without per-call-site migration.
 */
const LEGACY_KEY_MAP: Record<string, string> = {
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
};

function canonicalKey(key: string): string {
	return LEGACY_KEY_MAP[key] ?? key;
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

	function readValue(rawKey: string): unknown {
		const key = canonicalKey(rawKey);
		if (isKvKey(key)) return map.get(key);
		if (isDeviceKey(key)) return deviceConfig.get(key as never);
		return undefined;
	}

	function writeValue(rawKey: string, value: unknown): void {
		const key = canonicalKey(rawKey);
		if (isKvKey(key)) {
			workspace.kv.set(key, value as never);
			return;
		}
		if (isDeviceKey(key)) {
			deviceConfig.set(key as never, value as never);
		}
	}

	/**
	 * Proxy that emulates the fork's legacy `settings.value[key]` read/write API.
	 * Each access routes through readValue/writeValue, which handle key renames
	 * and device/synced storage routing transparently.
	 */
	const valueProxy = new Proxy({} as Record<string, unknown>, {
		get: (_target, prop) => {
			if (typeof prop !== 'string') return undefined;
			return readValue(prop);
		},
		set: (_target, prop, value) => {
			if (typeof prop !== 'string') return false;
			writeValue(prop, value);
			return true;
		},
	});

	return {
		/**
		 * Get a setting value. Accepts either the canonical key or a legacy
		 * fork-era key name; routes to workspace.kv or deviceConfig.
		 */
		get<K extends keyof KvDefs & string>(key: K): InferKvValue<KvDefs[K]> {
			return readValue(key) as InferKvValue<KvDefs[K]>;
		},

		/**
		 * Set a setting value. Writes go to workspace.kv or deviceConfig
		 * depending on whether the key is synced or device-bound.
		 */
		set<K extends keyof KvDefs & string>(
			key: K,
			value: InferKvValue<KvDefs[K]>,
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
		 */
		get value(): Record<string, unknown> {
			return valueProxy;
		},

		updateKey(key: string, value: unknown): void {
			writeValue(key, value);
		},
	};
}

export const settings = createSettings();
