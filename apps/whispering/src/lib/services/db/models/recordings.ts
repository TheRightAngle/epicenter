/**
 * Recording intermediate representation.
 *
 * This type represents the unified interface for recordings across the application.
 * It is NOT the storage format - different storage implementations use different formats:
 *
 * - Desktop: Stores metadata in markdown files (.md) and audio in separate files (.webm, .mp3)
 * - Web: Stores in IndexedDB with serialized audio (see web/dexie-schemas.ts)
 *
 * Both implementations read their storage format and convert it to this intermediate
 * representation for use in the UI layer.
 *
 * Audio access: Audio data is NOT stored in this intermediate representation. Instead, use:
 * - `db.recordings.getAudioBlob(id)` to fetch audio as a Blob
 * - `db.recordings.ensureAudioPlaybackUrl(id)` to get a playback URL
 * - `db.recordings.revokeAudioUrl(id)` to clean up cached URLs
 */
export type Recording = {
	id: string;
	title: string;
	subtitle: string;
	timestamp: string;
	createdAt: string;
	updatedAt: string;
	transcribedText: string;
	/**
	 * Recording lifecycle status:
	 * 1. Begins in 'UNPROCESSED' state
	 * 2. Moves to 'TRANSCRIBING' while audio is being transcribed
	 * 3. Marked as 'DONE' when transcription completes
	 * 4. Marked as 'FAILED' if transcription fails
	 */
	transcriptionStatus: 'UNPROCESSED' | 'TRANSCRIBING' | 'DONE' | 'FAILED';
};
