import { type } from 'arktype';
import { Ok, type Result } from 'wellcrafted/result';
import { WhisperingErr, type WhisperingError } from '$lib/result';
import { HttpServiceLive } from '$lib/services/http';

const MAX_FILE_SIZE_MB = 500 as const; // Deepgram supports larger files

// Schema for Deepgram API response
const DeepgramResponse = type({
	results: {
		channels: type({
			alternatives: type({
				transcript: 'string',
				'confidence?': 'number',
			}).array(),
		}).array(),
	},
});

export const DeepgramTranscriptionServiceLive = {
	async transcribe(
		audioBlob: Blob,
		options: {
			prompt: string;
			temperature: string;
			outputLanguage: string;
			apiKey: string;
			modelName: string;
		},
	): Promise<Result<string, WhisperingError>> {
		// Pre-validation: Check API key
		if (!options.apiKey) {
			return WhisperingErr({
				title: '🔑 API Key Required',
				description:
					'Please enter your Deepgram API key in settings to use Deepgram transcription.',
				action: {
					type: 'link',
					label: 'Add API key',
					href: '/settings/transcription',
				},
			});
		}

		// Validate file size
		const blobSizeInMb = audioBlob.size / (1024 * 1024);
		if (blobSizeInMb > MAX_FILE_SIZE_MB) {
			return WhisperingErr({
				title: `The file size (${blobSizeInMb}MB) is too large`,
				description: `Please upload a file smaller than ${MAX_FILE_SIZE_MB}MB.`,
			});
		}

		// Build query parameters
		const params = new URLSearchParams({
			model: options.modelName,
			smart_format: 'true',
			punctuate: 'true',
			paragraphs: 'true',
		});

		if (options.outputLanguage !== 'auto') {
			params.append('language', options.outputLanguage);
		}

		if (options.prompt) {
			const isNova3 = options.modelName.toLowerCase().includes('nova-3');
			params.append(isNova3 ? 'keyterm' : 'keywords', options.prompt);
		}

		// Send raw audio data directly as recommended by Deepgram docs
		const { data: deepgramResponse, error: postError } =
			await HttpServiceLive.post({
				url: `https://api.deepgram.com/v1/listen?${params.toString()}`,
				body: audioBlob, // Send raw audio blob directly
				headers: {
					Authorization: `Token ${options.apiKey}`,
					'Content-Type': audioBlob.type || 'audio/*', // Use the blob's mime type or fallback to audio/*
				},
				schema: DeepgramResponse,
			});

		if (postError) {
			switch (postError.name) {
				case 'Connection': {
					return WhisperingErr({
						title: '🌐 Connection Issue',
						description:
							'Unable to connect to Deepgram service. Please check your internet connection.',
						action: { type: 'more-details', error: postError },
					});
				}

				case 'Response': {
					const { status, message } = postError;

					if (status === 400) {
						return WhisperingErr({
							title: '❌ Bad Request',
							description:
								message ||
								'Invalid request parameters. Please check your audio file and settings.',
							action: { type: 'more-details', error: postError },
						});
					}

					if (status === 401) {
						return WhisperingErr({
							title: '🔑 Authentication Failed',
							description:
								'Your Deepgram API key is invalid or expired. Please update your API key in settings.',
							action: {
								type: 'link',
								label: 'Update API key',
								href: '/settings/transcription',
							},
						});
					}

					if (status === 403) {
						return WhisperingErr({
							title: '⛔ Access Denied',
							description:
								message ||
								'Your account does not have access to this feature or model.',
							action: { type: 'more-details', error: postError },
						});
					}

					if (status === 413) {
						return WhisperingErr({
							title: '📦 Audio File Too Large',
							description:
								'Your audio file exceeds the maximum size limit. Try splitting it into smaller segments.',
							action: { type: 'more-details', error: postError },
						});
					}

					if (status === 415) {
						return WhisperingErr({
							title: '🎵 Unsupported Format',
							description:
								"This audio format isn't supported. Please convert your file to a supported format.",
							action: { type: 'more-details', error: postError },
						});
					}

					if (status === 429) {
						return WhisperingErr({
							title: '⏱️ Rate Limit Reached',
							description:
								'Too many requests. Please wait before trying again.',
							action: { type: 'more-details', error: postError },
						});
					}

					if (status && status >= 500) {
						return WhisperingErr({
							title: '🔧 Service Unavailable',
							description: `The Deepgram service is temporarily unavailable (Error ${status}). Please try again later.`,
							action: { type: 'more-details', error: postError },
						});
					}

					return WhisperingErr({
						title: '❌ Transcription Failed',
						description:
							message ||
							'An unexpected error occurred during transcription. Please try again.',
						action: { type: 'more-details', error: postError },
					});
				}

				case 'Parse':
					return WhisperingErr({
						title: '🔍 Response Error',
						description:
							'Received an unexpected response from Deepgram service. Please try again.',
						action: { type: 'more-details', error: postError },
					});

				default:
					return WhisperingErr({
						title: '❓ Unexpected Error',
						description:
							'An unexpected error occurred during transcription. Please try again.',
						action: { type: 'more-details', error: postError },
					});
			}
		}

		// Extract transcription text
		const transcript = deepgramResponse.results?.channels
			?.at(0)
			?.alternatives?.at(0)?.transcript;

		if (!transcript) {
			return WhisperingErr({
				title: '📝 No Transcription Found',
				description:
					'No speech was detected in the audio file. Please check your audio and try again.',
			});
		}

		return Ok(transcript.trim());
	},
};

export type DeepgramTranscriptionService =
	typeof DeepgramTranscriptionServiceLive;
