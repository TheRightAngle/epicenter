<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';
	import { Button } from '@epicenter/ui/button';
	import { Progress } from '@epicenter/ui/progress';
	import { Spinner } from '@epicenter/ui/spinner';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';
	import { join } from '@tauri-apps/api/path';
	import { exists, mkdir, remove } from '@tauri-apps/plugin-fs';
	import { toast } from 'svelte-sonner';
	import { extractErrorMessage } from 'wellcrafted/error';
	import { Ok, tryAsync } from 'wellcrafted/result';
	import { PATHS } from '$lib/constants/paths';
	import type { LocalModelConfig } from '$lib/services/transcription/local/types';
	import {
		clearCachedLocalModelValidity,
		downloadLocalModelToDestination,
		validateConfiguredLocalModelPath,
	} from '$lib/components/settings/local-models';
	import { settings } from '$lib/state/settings.svelte';

	let {
		model,
	}: {
		model: LocalModelConfig;
	} = $props();

	type ModelState =
		| { type: 'not-downloaded' }
		| { type: 'downloading'; progress: number }
		| { type: 'ready' }
		| { type: 'active' };

	let modelState = $state<ModelState>({ type: 'not-downloaded' });

	/**
	 * Calculates the destination path where this model will be downloaded and stored,
	 * and ensures that the parent directory structure exists.
	 *
	 * @returns The full path where the model should be stored:
	 * - For Whisper models: `{appDataDir}/models/whisper/{filename}` (a single file)
	 * - For Parakeet models: `{appDataDir}/models/parakeet/{directoryName}/` (a directory containing multiple files)
	 * - For Moonshine models: `{appDataDir}/models/moonshine/{directoryName}/` (a directory containing multiple files)
	 */
	async function ensureModelDestinationPath(): Promise<string> {
		switch (model.engine) {
			case 'whispercpp': {
				const modelsDir = await PATHS.MODELS.WHISPER();
				// Ensure directory exists
				if (!(await exists(modelsDir))) {
					await mkdir(modelsDir, { recursive: true });
				}
				return await join(modelsDir, model.file.filename);
			}
			case 'parakeet': {
				// Parakeet models are stored in a directory
				const parakeetModelsDir = await PATHS.MODELS.PARAKEET();
				// Ensure directory exists
				if (!(await exists(parakeetModelsDir))) {
					await mkdir(parakeetModelsDir, { recursive: true });
				}
				return await join(parakeetModelsDir, model.directoryName);
			}
			case 'moonshine': {
				// Moonshine models are stored in a directory
				const moonshineModelsDir = await PATHS.MODELS.MOONSHINE();
				// Ensure directory exists
				if (!(await exists(moonshineModelsDir))) {
					await mkdir(moonshineModelsDir, { recursive: true });
				}
				return await join(moonshineModelsDir, model.directoryName);
			}
		}
	}

	// Check model status on mount and when settings change
	$effect(() => {
		// React to settings changes for this engine
		const settingsKey = `transcription.${model.engine}.modelPath` as const;
		const currentPath = settings.value[settingsKey];
		// Trigger refresh when settings change (currentPath is a dependency)
		refreshStatus();
	});

	async function refreshStatus() {
		await tryAsync({
			try: async () => {
				const path = await ensureModelDestinationPath();
				const isValid = await validateConfiguredLocalModelPath(
					model.engine,
					path,
				);

				if (!isValid) {
					modelState = { type: 'not-downloaded' };
					return;
				}

				// Check if this model is active in settings
				const settingsKey = `transcription.${model.engine}.modelPath` as const;
				const currentPath = settings.value[settingsKey];
				const isActive = currentPath === path;

				modelState = isActive ? { type: 'active' } : { type: 'ready' };
			},
			catch: () => {
				modelState = { type: 'not-downloaded' };
				return Ok(undefined);
			},
		});
	}

	async function downloadModel() {
		if (modelState.type === 'downloading') return;

		modelState = { type: 'downloading', progress: 0 };
		const path = await ensureModelDestinationPath();

		await tryAsync({
			try: async () => {
				// Check if already exists
				await refreshStatus();
				if (modelState.type === 'ready' || modelState.type === 'active') {
					if (modelState.type === 'ready') {
						await activateModel({ showToast: false });
						toast.success('Model activated');
					}
					return;
				}

				switch (model.engine) {
					case 'whispercpp':
					case 'parakeet':
					case 'moonshine':
						await downloadLocalModelToDestination({
							model,
							destinationPath: path,
							onProgress: (progress) => {
								modelState = { type: 'downloading', progress };
							},
						});
						break;
				}

				const isValid = await validateConfiguredLocalModelPath(model.engine, path);
				if (!isValid) {
					throw new Error('Downloaded model did not pass runtime validation.');
				}

				// After download, activate the model
				await activateModel({ showToast: false });
				modelState = { type: 'active' };
				toast.success('Model downloaded and activated successfully');
			},
			catch: (error) => {
				console.error('Download failed:', error);
				clearCachedLocalModelValidity(path);
				toast.error('Failed to download model', {
					description: extractErrorMessage(error),
				});
				modelState = { type: 'not-downloaded' };
				return Ok(undefined);
			},
		});
	}

	async function activateModel({
		showToast = true,
	}: {
		showToast?: boolean;
	} = {}) {
		const path = await ensureModelDestinationPath();
		const settingsKey = `transcription.${model.engine}.modelPath` as const;

		settings.updateKey(settingsKey, path);
		// The settings watcher will update modelState to 'active'
		if (showToast) {
			toast.success('Model activated');
		}
	}

	async function deleteModel() {
		await tryAsync({
			try: async () => {
				const path = await ensureModelDestinationPath();
				if (await exists(path)) {
					const isDirectory =
						model.engine === 'parakeet' || model.engine === 'moonshine';
					await remove(path, { recursive: isDirectory });
				}

				// Clear settings if this was the active model
				const settingsKey = `transcription.${model.engine}.modelPath` as const;

				if (settings.value[settingsKey] === path) {
					settings.updateKey(settingsKey, '');
				}
				clearCachedLocalModelValidity(path);

				modelState = { type: 'not-downloaded' };
				toast.success('Model deleted');
			},
			catch: (error) => {
				toast.error('Failed to delete model', {
					description: extractErrorMessage(error),
				});
				return Ok(undefined);
			},
		});
	}
</script>

<div
	class="flex items-center gap-3 p-3 rounded-lg border {modelState.type ===
	'active'
		? 'border-primary bg-primary/5'
		: ''}"
>
	<div class="flex-1">
		<div class="flex items-center gap-2">
			<span class="font-medium">{model.name}</span>
			{#if modelState.type === 'active'}
				<Badge variant="default" class="text-xs">Active</Badge>
			{:else if modelState.type === 'ready'}
				<Badge variant="secondary" class="text-xs">Downloaded</Badge>
			{/if}
		</div>
		<div class="text-sm text-muted-foreground">{model.description}</div>
		<div class="text-xs text-muted-foreground mt-1">{model.size}</div>
	</div>

	<div class="flex items-center gap-2">
		{#if modelState.type === 'downloading'}
			<div class="flex items-center gap-2 min-w-[120px]">
				<Spinner />
				<span class="text-sm font-medium">{modelState.progress}%</span>
			</div>
		{:else if modelState.type === 'ready'}
			<Button size="sm" variant="outline" onclick={activateModel}>
				Activate
			</Button>
			<Button size="sm" variant="ghost" onclick={deleteModel}>
				<X class="size-4" />
			</Button>
		{:else if modelState.type === 'active'}
			<Button size="sm" variant="default" disabled>
				<CheckIcon class="size-4 mr-1" />
				Activated
			</Button>
			<Button size="sm" variant="ghost" onclick={deleteModel}>
				<X class="size-4" />
			</Button>
		{:else}
			<Button size="sm" variant="outline" onclick={downloadModel}>
				<Download class="size-4" />
				Download
			</Button>
		{/if}
	</div>
</div>

{#if modelState.type === 'downloading' && modelState.progress > 0}
	<Progress value={modelState.progress} class="mt-2 h-2" />
{/if}
