<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { useCombobox } from '@epicenter/ui/hooks';
	import * as Popover from '@epicenter/ui/popover';
	import { Separator } from '@epicenter/ui/separator';
	import { cn } from '@epicenter/ui/utils';
	import PackageIcon from '@lucide/svelte/icons/package';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { goto } from '$app/navigation';
	import { CompressionBody } from '$lib/components/settings';
	import { settings } from '$lib/state/settings.svelte';
	import { isCompressionRecommended } from '$routes/(app)/_layout-utils/check-ffmpeg';

	let { class: className }: { class?: string } = $props();

	const popover = useCombobox();

	// Check if we should show "Recommended" badge
	const shouldShowRecommendedBadge = $derived(isCompressionRecommended());

	// Visual state for the button icon
	const isCompressionEnabled = $derived(
		settings.get('transcription.compressionEnabled'),
	);
</script>

<Popover.Root bind:open={popover.open}>
	<Popover.Trigger bind:ref={popover.triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				class={cn('relative', className)}
				tooltip={isCompressionEnabled
					? 'Compression enabled - click to configure'
					: 'Audio compression disabled - click to enable'}
				variant="ghost"
				size="icon"
			>
				<PackageIcon
					class={cn(
						'text-lg',
						isCompressionEnabled ? 'opacity-100' : 'opacity-60',
					)}
				>
					🗜️
				</PackageIcon>

				<!-- Recommended badge indicator -->
				{#if shouldShowRecommendedBadge}
					<span
						class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-blue-500 before:absolute before:left-0 before:top-0 before:h-full before:w-full before:rounded-full before:bg-blue-500/50 before:animate-ping"
					></span>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>

	<Popover.Content class="sm:w-[36rem] max-h-[40vh] overflow-auto p-0">
		<div class="p-4"><CompressionBody /></div>
		<Separator />
		<Button
			variant="ghost"
			size="sm"
			class="w-full justify-start text-muted-foreground rounded-none"
			onclick={() => {
				goto('/settings/transcription');
				popover.open = false;
			}}
		>
			<SettingsIcon class="h-4 w-4" />
			Configure in transcription settings
		</Button>
	</Popover.Content>
</Popover.Root>
