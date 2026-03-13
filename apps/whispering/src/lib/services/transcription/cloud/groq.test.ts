import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('GroqTranscriptionServiceLive', () => {
	test('rejects xAI keys for the official Groq endpoint', async () => {
		const source = readFileSync(new URL('./groq.ts', import.meta.url), 'utf8');

		expect(source).toContain("options.apiKey.startsWith('gsk_')");
		expect(source).not.toContain("options.apiKey.startsWith('xai-')");
		expect(source).toContain('Your Groq API key should start with "gsk_".');
	});
});
