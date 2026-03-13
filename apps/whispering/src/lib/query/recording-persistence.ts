import type { Settings } from '$lib/settings';

type RecordingPersistenceSettings = {
	recordingRetentionStrategy: Settings['database.recordingRetentionStrategy'];
	maxRecordingCount: Settings['database.maxRecordingCount'];
};

export function shouldPersistRecordings({
	recordingRetentionStrategy,
	maxRecordingCount,
}: RecordingPersistenceSettings): boolean {
	if (recordingRetentionStrategy !== 'limit-count') {
		return true;
	}

	return Number.parseInt(maxRecordingCount, 10) > 0;
}
