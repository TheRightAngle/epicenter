import { describe, expect, test } from 'bun:test';
import { getDefaultTranscriptionServiceId } from './default-transcription-service';

describe('getDefaultTranscriptionServiceId', () => {
	test('defaults Windows to parakeet', () => {
		expect(getDefaultTranscriptionServiceId('windows')).toBe('parakeet');
	});

	test('defaults non-Windows platforms to moonshine', () => {
		expect(getDefaultTranscriptionServiceId('macos')).toBe('moonshine');
		expect(getDefaultTranscriptionServiceId('linux')).toBe('moonshine');
		expect(getDefaultTranscriptionServiceId('android')).toBe('moonshine');
		expect(getDefaultTranscriptionServiceId('ios')).toBe('moonshine');
	});
});
