import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';

import type {
	Recording,
	Transformation,
	TransformationRun,
	TransformationRunCompleted,
	TransformationRunFailed,
	TransformationStepRun,
} from './models';

export const DbError = defineErrors({
	QueryFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to query database: ${extractErrorMessage(cause)}`,
		cause,
	}),
	MutationFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to write to database: ${extractErrorMessage(cause)}`,
		cause,
	}),
	MigrationFailed: ({ cause }: { cause: unknown }) => ({
		message: `Database migration failed: ${extractErrorMessage(cause)}`,
		cause,
	}),
	NoValidFiles: () => ({
		message: 'No valid audio or video files found',
	}),
});
export type DbError = InferErrors<typeof DbError>;

type RecordingWithAudio = { recording: Recording; audio: Blob };

export type DbService = {
	recordings: {
		getAll(): Promise<Result<Recording[], DbError>>;
		getLatest(): Promise<Result<Recording | null, DbError>>;
		getTranscribingIds(): Promise<Result<string[], DbError>>;
		getById(id: string): Promise<Result<Recording | null, DbError>>;
		create(
			params: RecordingWithAudio | RecordingWithAudio[],
		): Promise<Result<void, DbError>>;
		update(recording: Recording): Promise<Result<Recording, DbError>>;
		delete(recording: Recording | Recording[]): Promise<Result<void, DbError>>;
		cleanupExpired(params: {
			recordingRetentionStrategy: 'keep-forever' | 'limit-count';
			maxRecordingCount: number;
		}): Promise<Result<void, DbError>>;
		clear(): Promise<Result<void, DbError>>;
		getCount(): Promise<Result<number, DbError>>;

		/**
		 * Get audio blob by recording ID. Fetches audio on-demand.
		 * - Desktop: Reads file from predictable path using services.fs.pathToBlob()
		 * - Web: Fetches from IndexedDB by ID, converts serializedAudio to Blob
		 */
		getAudioBlob(recordingId: string): Promise<Result<Blob, DbError>>;

		/**
		 * Get audio playback URL. Creates and caches URL.
		 * - Desktop: Uses convertFileSrc() to create asset:// URL
		 * - Web: Creates and caches object URL, manages lifecycle
		 */
		ensureAudioPlaybackUrl(
			recordingId: string,
		): Promise<Result<string, DbError>>;

		/**
		 * Revoke audio URL if cached. Cleanup method.
		 * - Desktop: No-op (asset:// URLs managed by Tauri)
		 * - Web: Calls URL.revokeObjectURL() and removes from cache
		 */
		revokeAudioUrl(recordingId: string): void;
	};
	transformations: {
		getAll(): Promise<Result<Transformation[], DbError>>;
		getById(id: string): Promise<Result<Transformation | null, DbError>>;
		create(
			transformation: Transformation | Transformation[],
		): Promise<Result<void, DbError>>;
		update(
			transformation: Transformation,
		): Promise<Result<Transformation, DbError>>;
		delete(
			transformation: Transformation | Transformation[],
		): Promise<Result<void, DbError>>;
		clear(): Promise<Result<void, DbError>>;
		getCount(): Promise<Result<number, DbError>>;
	};
	runs: {
		getAll(): Promise<Result<TransformationRun[], DbError>>;
		getById(id: string): Promise<Result<TransformationRun | null, DbError>>;
		getByTransformationId(
			transformationId: string,
		): Promise<Result<TransformationRun[], DbError>>;
		getByRecordingId(
			recordingId: string,
		): Promise<Result<TransformationRun[], DbError>>;
		create(
			run: TransformationRun | TransformationRun[],
		): Promise<Result<void, DbError>>;
		addStep(
			run: TransformationRun,
			step: {
				id: string;
				input: string;
			},
		): Promise<Result<TransformationStepRun, DbError>>;
		failStep(
			run: TransformationRun,
			stepRunId: string,
			error: string,
		): Promise<Result<TransformationRunFailed, DbError>>;
		completeStep(
			run: TransformationRun,
			stepRunId: string,
			output: string,
		): Promise<Result<TransformationRun, DbError>>;
		complete(
			run: TransformationRun,
			output: string,
		): Promise<Result<TransformationRunCompleted, DbError>>;
		delete(
			run: TransformationRun | TransformationRun[],
		): Promise<Result<void, DbError>>;
		clear(): Promise<Result<void, DbError>>;
		getCount(): Promise<Result<number, DbError>>;
	};
};
