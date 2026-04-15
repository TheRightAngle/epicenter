<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { cn } from '@epicenter/ui/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import { commandCallbacks } from '$lib/commands';
	import {
		CompressionSelector,
		RecordingModeSelector,
		TranscriptionSelector,
		TransformationSelector,
	} from '$lib/components/settings';
	import ManualDeviceSelector from '$lib/components/settings/selectors/ManualDeviceSelector.svelte';
	import VadDeviceSelector from '$lib/components/settings/selectors/VadDeviceSelector.svelte';
	import {
		RECORDER_STATE_TO_ICON,
		VAD_STATE_TO_ICON,
	} from '$lib/constants/audio';
	import { rpc } from '$lib/query';
	import { settings } from '$lib/state/settings.svelte';
	import { vadRecorder } from '$lib/state/vad-recorder.svelte';
	import { viewTransition } from '$lib/utils/viewTransitions';

	const getRecorderStateQuery = createQuery(
		() => rpc.recorder.getRecorderState.options,
	);

	let { children } = $props();
</script>

<header
	class={cn(
		'border-border/40 bg-background/95 supports-backdrop-filter:bg-background/60 z-30 border-b shadow-xs backdrop-blur-sm',
		'flex h-14 w-full items-center justify-between px-4 sm:px-8',
	)}
	style="view-transition-name: {viewTransition.global.header}"
>
	<Button tooltip="Go home" href="/" variant="ghost" class="-ml-4">
		<span class="text-lg font-bold">whispering</span>
	</Button>

	<div class="flex items-center gap-1.5">
		<div class="flex items-center gap-1.5">
			{#if settings.get('recording.mode') === 'manual'}
				{#if getRecorderStateQuery.data === 'RECORDING'}
					<Button
						tooltip="Cancel recording"
						onclick={() => commandCallbacks.cancelManualRecording()}
						variant="ghost"
						size="icon"
						style="view-transition-name: {viewTransition.global.cancel};"
					>
						🚫
					</Button>
				{:else}
					<ManualDeviceSelector />
					<CompressionSelector />
					<TranscriptionSelector />
					<TransformationSelector />
				{/if}
				{#if getRecorderStateQuery.data === 'RECORDING'}
					<Button
						tooltip="Stop recording"
						onclick={() => commandCallbacks.toggleManualRecording()}
						variant="ghost"
						size="icon"
						style="view-transition-name: {viewTransition.global.microphone}"
					>
						{RECORDER_STATE_TO_ICON[getRecorderStateQuery.data ?? 'IDLE']}
					</Button>
				{:else}
					<div class="flex">
						<Button
							tooltip="Start recording"
							onclick={() => commandCallbacks.toggleManualRecording()}
							variant="ghost"
							size="icon"
							style="view-transition-name: {viewTransition.global.microphone}"
							class="rounded-r-none border-r-0"
						>
							{RECORDER_STATE_TO_ICON[getRecorderStateQuery.data ?? 'IDLE']}
						</Button>
						<RecordingModeSelector class="rounded-l-none" />
					</div>
				{/if}
			{:else if settings.get('recording.mode') === 'vad'}
				{#if vadRecorder.state === 'IDLE'}
					<VadDeviceSelector />
					<CompressionSelector />
					<TranscriptionSelector />
					<TransformationSelector />
				{/if}
				{#if vadRecorder.state === 'IDLE'}
					<div class="flex">
						<Button
							tooltip="Start voice activated recording"
							onclick={() => commandCallbacks.toggleVadRecording()}
							variant="ghost"
							size="icon"
							style="view-transition-name: {viewTransition.global.microphone}"
							class="rounded-r-none border-r-0"
						>
							{VAD_STATE_TO_ICON[vadRecorder.state]}
						</Button>
						<RecordingModeSelector class="rounded-l-none" />
					</div>
				{:else}
					<Button
						tooltip="Stop voice activated recording"
						onclick={() => commandCallbacks.toggleVadRecording()}
						variant="ghost"
						size="icon"
						style="view-transition-name: {viewTransition.global.microphone}"
					>
						{VAD_STATE_TO_ICON[vadRecorder.state]}
					</Button>
				{/if}
			{:else if settings.get('recording.mode') === 'upload'}
				<CompressionSelector />
				<TranscriptionSelector />
				<TransformationSelector />
				<RecordingModeSelector />
			{/if}
		</div>
	</div>
</header>

<div class="flex-1 overflow-x-auto">{@render children()}</div>
