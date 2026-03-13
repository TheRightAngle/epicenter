import { describe, expect, test } from 'bun:test';

import { shouldPersistRecordings } from './recording-persistence';

describe('shouldPersistRecordings', () => {
	test('returns false when retention is limited to zero recordings', () => {
		expect(
			shouldPersistRecordings({
				recordingRetentionStrategy: 'limit-count',
				maxRecordingCount: '0',
			}),
		).toBe(false);
	});

	test('returns true when retention is limited to a non-zero count', () => {
		expect(
			shouldPersistRecordings({
				recordingRetentionStrategy: 'limit-count',
				maxRecordingCount: '5',
			}),
		).toBe(true);
	});

	test('returns true when retention keeps recordings forever', () => {
		expect(
			shouldPersistRecordings({
				recordingRetentionStrategy: 'keep-forever',
				maxRecordingCount: '0',
			}),
		).toBe(true);
	});
});
