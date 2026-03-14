import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Windows CPAL capture diagnostics source', () => {
	test('logs experimental capture callback diagnostics and worker thread ids', () => {
		const source = readFileSync(
			new URL('../src/recorder/recorder.rs', import.meta.url),
			'utf8',
		);

		expect(source).toContain('struct CaptureDiagnostics');
		expect(source).toContain('Recorder worker thread started: os_thread_id=');
		expect(source).toContain('Experimental capture diagnostics: callback_thread_id=');
		expect(source).toContain('windows_sys::Win32::System::Threading::GetCurrentThreadId()');
	});
});
