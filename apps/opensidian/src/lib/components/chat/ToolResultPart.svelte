<script lang="ts">
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { ToolResultPart as TanStackToolResultPart } from '@tanstack/ai-client';

	let {
		part,
	}: {
		part: TanStackToolResultPart;
	} = $props();
</script>

<!--
	Tool results for completed calls are already shown inside ToolCallPart's
	collapsible Details section. Only render streaming/error states here.
-->
{#if part.state === 'streaming'}
	<div class="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
		<LoaderCircleIcon class="size-3 animate-spin" />
		Processing…
	</div>
{:else if part.state === 'error'}
	<div
		class="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
	>
		<AlertCircleIcon class="size-3 shrink-0" />
		<span>{part.error ?? 'Tool execution failed'}</span>
	</div>
{/if}
