import { ElevenLabsClient } from 'elevenlabs';
import { type Result, tryAsync } from 'wellcrafted/result';
import { WhisperingErr, type WhisperingError } from '$lib/result';

export const ElevenlabsTranscriptionServiceLive = {
	transcribe: async (
		audioBlob: Blob,
		options: {
			prompt: string;
			temperature: string;
			outputLanguage: string;
			apiKey: string;
			modelName: string;
		},
	): Promise<Result<string, WhisperingError>> => {
		if (!options.apiKey) {
			return WhisperingErr({
				title: '🔑 API Key Required',
				description:
					'Please enter your ElevenLabs API key in settings to use speech-to-text transcription.',
				action: {
					type: 'link',
					label: 'Add API key',
					href: '/settings/transcription',
				},
			});
		}

		const client = new ElevenLabsClient({ apiKey: options.apiKey });

		// Check file size (no try needed — pure logic)
		const blobSizeInMb = audioBlob.size / (1024 * 1024);
		const MAX_FILE_SIZE_MB = 1000;
		if (blobSizeInMb > MAX_FILE_SIZE_MB) {
			return WhisperingErr({
				title: '📁 File Size Too Large',
				description: `Your audio file (${blobSizeInMb.toFixed(1)}MB) exceeds the ${MAX_FILE_SIZE_MB}MB limit. Please use a smaller file or compress the audio.`,
			});
		}

		return tryAsync({
			try: async () => {
				const transcription = await client.speechToText.convert({
					file: audioBlob,
					model_id: options.modelName,
					language_code:
						options.outputLanguage !== 'auto'
							? options.outputLanguage
							: undefined,
					tag_audio_events: false,
					diarize: true,
				});
				return transcription.text.trim();
			},
			catch: (error) =>
				WhisperingErr({
					title: '🔧 Transcription Failed',
					description:
						'Unable to complete the transcription using ElevenLabs. This may be due to a service issue or unsupported audio format. Please try again.',
					action: { type: 'more-details', error },
				}),
		});
	},
};

export type ElevenLabsTranscriptionService =
	typeof ElevenlabsTranscriptionServiceLive;
