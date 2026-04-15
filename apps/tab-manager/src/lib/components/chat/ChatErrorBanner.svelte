<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		error,
		dismissedError,
		onRetry,
		onDismiss,
	}: {
		error: Error | undefined;
		dismissedError: string | null;
		onRetry: () => void;
		onDismiss: () => void;
	} = $props();

	const visible = $derived(error && error.message !== dismissedError);
</script>

{#if visible}
	<div
		role="alert"
		class="flex items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
	>
		<span class="min-w-0 flex-1">{displayMessage}</span>
		<div class="flex shrink-0 items-center gap-1">
			<Button variant="ghost-destructive" onclick={onRetry}>
				<RotateCcwIcon class="size-3" />
				Retry
			</Button>
			<Button variant="ghost-destructive" size="icon-xs" onclick={onDismiss}>
				<XIcon class="size-3" />
			</Button>
		</div>
	</div>
{/if}
