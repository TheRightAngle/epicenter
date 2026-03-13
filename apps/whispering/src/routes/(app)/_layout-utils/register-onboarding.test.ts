import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const notifyInfoMock = mock<any>(() => undefined);
const getSelectedTranscriptionServiceMock = mock<any>(() => undefined);
const isTranscriptionServiceConfiguredMock = mock<any>(() => false);
const refreshTranscriptionServiceConfigurationMock = mock<any>(async () => false);

async function loadRegisterOnboardingModule() {
	return await import('./register-onboarding');
}

beforeEach(() => {
	mock.restore();
	notifyInfoMock.mockReset();
	getSelectedTranscriptionServiceMock.mockReset();
	isTranscriptionServiceConfiguredMock.mockReset();
	refreshTranscriptionServiceConfigurationMock.mockReset();

	getSelectedTranscriptionServiceMock.mockReturnValue(undefined);
	isTranscriptionServiceConfiguredMock.mockReturnValue(false);
	refreshTranscriptionServiceConfigurationMock.mockResolvedValue(false);

	mock.module('$lib/query', () => ({
		rpc: {
			notify: {
				info: notifyInfoMock,
			},
		},
	}));

	mock.module('$lib/settings/transcription-validation', () => ({
		getSelectedTranscriptionService: getSelectedTranscriptionServiceMock,
		isTranscriptionServiceConfigured: isTranscriptionServiceConfiguredMock,
		refreshTranscriptionServiceConfiguration:
			refreshTranscriptionServiceConfigurationMock,
	}));
});

afterEach(() => {
	mock.restore();
});

describe('registerOnboarding', () => {
	test('does not show onboarding when a local transcription service validates on refresh', async () => {
		getSelectedTranscriptionServiceMock.mockReturnValue({
			id: 'parakeet',
			name: 'Parakeet',
			location: 'local',
		});
		isTranscriptionServiceConfiguredMock.mockReturnValue(false);
		refreshTranscriptionServiceConfigurationMock.mockResolvedValue(true);

		const { registerOnboarding } = await loadRegisterOnboardingModule();
		await registerOnboarding();

		expect(refreshTranscriptionServiceConfigurationMock).toHaveBeenCalledTimes(1);
		expect(notifyInfoMock).not.toHaveBeenCalled();
	});

	test('shows onboarding when a local transcription service remains unconfigured after refresh', async () => {
		getSelectedTranscriptionServiceMock.mockReturnValue({
			id: 'parakeet',
			name: 'Parakeet',
			location: 'local',
		});
		isTranscriptionServiceConfiguredMock.mockReturnValue(false);
		refreshTranscriptionServiceConfigurationMock.mockResolvedValue(false);

		const { registerOnboarding } = await loadRegisterOnboardingModule();
		await registerOnboarding();

		expect(refreshTranscriptionServiceConfigurationMock).toHaveBeenCalledTimes(1);
		expect(notifyInfoMock).toHaveBeenCalledTimes(1);
		const [notification] = notifyInfoMock.mock.calls[0] ?? [];
		expect(notification).toMatchObject({
			title: 'Welcome to Whispering!',
			description: 'Please configure your Parakeet model file to get started.',
		});
	});
});
