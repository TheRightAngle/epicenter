import type { OsType } from '@tauri-apps/plugin-os';
import type { TranscriptionServiceId } from '$lib/constants/transcription';

export function getDefaultTranscriptionServiceId(
	platform: OsType,
): TranscriptionServiceId {
	return platform === 'windows' ? 'parakeet' : 'moonshine';
}
