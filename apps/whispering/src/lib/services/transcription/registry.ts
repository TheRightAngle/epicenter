/**
 * Transcription service UI registry — icons, settings key mappings, and
 * platform-conditional availability. Pure data (model lists, capabilities,
 * labels) lives in `$lib/constants/transcription`.
 */

import deepgramIcon from '$lib/constants/icons/deepgram.svg?raw';
import elevenlabsIcon from '$lib/constants/icons/elevenlabs.svg?raw';
import ggmlIcon from '$lib/constants/icons/ggml.svg?raw';
import groqIcon from '$lib/constants/icons/groq.svg?raw';
import mistralIcon from '$lib/constants/icons/mistral.svg?raw';
import moonshineIcon from '$lib/constants/icons/moonshine.svg?raw';
import nvidiaIcon from '$lib/constants/icons/nvidia.svg?raw';
import openaiIcon from '$lib/constants/icons/openai.svg?raw';
import speachesIcon from '$lib/constants/icons/speaches.svg?raw';
import { IS_WINDOWS } from '$lib/constants/platform';
import {
	TRANSCRIPTION,
	type TranscriptionServiceId,
} from '$lib/constants/transcription';
import type { DeviceConfigKey } from '$lib/state/device-config.svelte';

// ── Service types ─────────────────────────────────────────────────────────────

type BaseTranscriptionService = {
	id: TranscriptionServiceId;
	name: string;
	icon: string; // SVG string
	invertInDarkMode: boolean; // Whether to invert the icon in dark mode
	description?: string;
};

type CloudTranscriptionService = BaseTranscriptionService & {
	location: 'cloud';
	models: readonly {
		readonly name: string;
		readonly description: string;
		readonly cost: string;
	}[];
	defaultModel: string;
	modelSettingKey: string;
	apiKeyField: DeviceConfigKey;
};

type SelfHostedTranscriptionService = BaseTranscriptionService & {
	location: 'self-hosted';
	serverUrlField: DeviceConfigKey;
};

type LocalTranscriptionService = BaseTranscriptionService & {
	location: 'local';
	modelPathField: DeviceConfigKey;
};

type SatisfiedTranscriptionService =
	| CloudTranscriptionService
	| SelfHostedTranscriptionService
	| LocalTranscriptionService;

// ── Service registry ──────────────────────────────────────────────────────────

export const TRANSCRIPTION_SERVICES = [
	// Local services first (truly offline)
	// Whisper C++ is not available on Windows due to upstream whisper-rs limitations and MSVC runtime library conflicts
	...(IS_WINDOWS
		? []
		: [
				{
					id: 'whispercpp',
					name: 'Whisper C++',
					icon: ggmlIcon,
					invertInDarkMode: true,
					description: 'Fast local transcription with no internet required',
					modelPathField: 'transcription.whispercpp.modelPath',
					location: 'local',
				} as const,
			]),
	{
		id: 'parakeet',
		name: 'Parakeet',
		icon: nvidiaIcon,
		invertInDarkMode: false,
		description: 'NVIDIA NeMo model for fast local transcription',
		modelPathField: 'transcription.parakeet.modelPath',
		location: 'local',
	},
	// Moonshine is not available on Windows due to MSVC runtime library conflicts.
	// The tokenizers/esaxx-rs CRT conflict was resolved in transcribe-rs 0.2.2,
	// but moonshine on Windows remains untested.
	...(IS_WINDOWS
		? []
		: [
				{
					id: 'moonshine',
					name: 'Moonshine',
					icon: moonshineIcon,
					invertInDarkMode: false,
					description: 'Efficient ONNX model by UsefulSensors',
					modelPathField: 'transcription.moonshine.modelPath',
					location: 'local',
				} as const,
			]),
	// Cloud services (API-based)
	{
		id: 'Groq',
		name: 'Groq',
		icon: groqIcon,
		invertInDarkMode: false,
		description: 'Lightning-fast cloud transcription',
		models: TRANSCRIPTION.Groq.models,
		defaultModel: TRANSCRIPTION.Groq.defaultModel,
		modelSettingKey: 'transcription.groq.model',
		apiKeyField: 'apiKeys.groq',
		location: 'cloud',
	},
	{
		id: 'OpenAI',
		name: 'OpenAI',
		icon: openaiIcon,
		invertInDarkMode: true,
		description: 'Industry-standard Whisper API',
		models: TRANSCRIPTION.OpenAI.models,
		defaultModel: TRANSCRIPTION.OpenAI.defaultModel,
		modelSettingKey: 'transcription.openai.model',
		apiKeyField: 'apiKeys.openai',
		location: 'cloud',
	},
	{
		id: 'ElevenLabs',
		name: 'ElevenLabs',
		icon: elevenlabsIcon,
		invertInDarkMode: true,
		description: 'Voice AI platform with transcription',
		models: TRANSCRIPTION.ElevenLabs.models,
		defaultModel: TRANSCRIPTION.ElevenLabs.defaultModel,
		modelSettingKey: 'transcription.elevenlabs.model',
		apiKeyField: 'apiKeys.elevenlabs',
		location: 'cloud',
	},
	{
		id: 'Deepgram',
		name: 'Deepgram',
		icon: deepgramIcon,
		invertInDarkMode: true,
		description: 'Real-time speech recognition API',
		models: TRANSCRIPTION.Deepgram.models,
		defaultModel: TRANSCRIPTION.Deepgram.defaultModel,
		modelSettingKey: 'transcription.deepgram.model',
		apiKeyField: 'apiKeys.deepgram',
		location: 'cloud',
	},
	{
		id: 'Mistral',
		name: 'Mistral AI',
		icon: mistralIcon,
		invertInDarkMode: false,
		description: 'Advanced Voxtral speech understanding',
		models: TRANSCRIPTION.Mistral.models,
		defaultModel: TRANSCRIPTION.Mistral.defaultModel,
		modelSettingKey: 'transcription.mistral.model',
		apiKeyField: 'apiKeys.mistral',
		location: 'cloud',
	},
	// Self-hosted services
	{
		id: 'speaches',
		name: 'Speaches',
		icon: speachesIcon,
		invertInDarkMode: false,
		description: 'Self-hosted transcription server',
		serverUrlField: 'transcription.speaches.baseUrl',
		location: 'self-hosted',
	},
] as const satisfies SatisfiedTranscriptionService[];

export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];
