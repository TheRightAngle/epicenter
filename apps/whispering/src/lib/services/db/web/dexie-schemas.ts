/**
 * IndexedDB-specific type definitions for Dexie schema migrations.
 *
 * These types represent historical and current storage formats used exclusively
 * by the web (IndexedDB) storage layer. They are NOT domain types — the app-wide
 * intermediate representation is the `Recording` type in `../models/recordings.ts`.
 *
 * @see {@link ../models/recordings.ts} for the domain type used by UI and services
 */
import type { Recording } from '../models/recordings';

/**
 * Serialized audio format for IndexedDB storage.
 *
 * This format is used to work around iOS Safari's limitations with storing Blob objects
 * in IndexedDB. Instead of storing the Blob directly (which can fail or become corrupted
 * on iOS), we deconstruct it into:
 * - arrayBuffer: The raw binary data
 * - blobType: The original MIME type (e.g., 'audio/webm', 'audio/wav')
 *
 * This can be reliably stored in IndexedDB on all platforms, including iOS Safari.
 * To reconstruct: new Blob([arrayBuffer], { type: blobType })
 */
export type SerializedAudio = {
	arrayBuffer: ArrayBuffer;
	blobType: string;
};

/**
 * How a recording is actually stored in IndexedDB (storage format).
 *
 * This is NOT the intermediate representation used by the UI (see Recording type).
 *
 * Extends Recording with:
 * - `serializedAudio` field for storing audio data (see SerializedAudio type)
 * - Audio is stored in serialized format to work around iOS Safari Blob storage issues
 */
export type RecordingStoredInIndexedDB = Recording & {
	serializedAudio: SerializedAudio | undefined;
};

export type RecordingsDbSchemaV5 = {
	recordings: RecordingStoredInIndexedDB;
};

export type RecordingsDbSchemaV4 = {
	recordings: RecordingsDbSchemaV3['recordings'] & {
		// V4 added 'createdAt' and 'updatedAt' fields
		createdAt: string;
		updatedAt: string;
	};
};

export type RecordingsDbSchemaV3 = {
	recordings: RecordingsDbSchemaV1['recordings'];
};

export type RecordingsDbSchemaV2 = {
	recordingMetadata: Omit<RecordingsDbSchemaV1['recordings'], 'blob'>;
	recordingBlobs: { id: string; blob: Blob | undefined };
};

export type RecordingsDbSchemaV1 = {
	recordings: {
		id: string;
		title: string;
		subtitle: string;
		timestamp: string;
		transcribedText: string;
		blob: Blob | undefined;
		/**
		 * A recording
		 * 1. Begins in an 'UNPROCESSED' state
		 * 2. Moves to 'TRANSCRIBING' while the audio is being transcribed
		 * 3. Finally is marked as 'DONE' when the transcription is complete.
		 * 4. If the transcription fails, it is marked as 'FAILED'
		 */
		transcriptionStatus: 'UNPROCESSED' | 'TRANSCRIBING' | 'DONE' | 'FAILED';
	};
};
