/**
 * Provider and model configuration for Zhongwen chat.
 *
 * Reuses TanStack AI provider packages for model lists.
 */

import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { GeminiTextModels } from '@tanstack/ai-gemini';
import { GROK_CHAT_MODELS } from '@tanstack/ai-grok';
import { OPENAI_CHAT_MODELS } from '@tanstack/ai-openai';

export const PROVIDER_MODELS = {
	openai: OPENAI_CHAT_MODELS,
	anthropic: ANTHROPIC_MODELS,
	gemini: GeminiTextModels,
	grok: GROK_CHAT_MODELS,
} as const;

export type Provider = keyof typeof PROVIDER_MODELS;

export const DEFAULT_PROVIDER: Provider = 'gemini';
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview' as const;
