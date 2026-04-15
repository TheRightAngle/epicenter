<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type {
		MessagePart,
		ToolResultPart as ToolResultPartType,
	} from '@tanstack/ai-client';
	import ToolCallPart from './ToolCallPart.svelte';
	import ToolResultPart from './ToolResultPart.svelte';

	let {
		parts,
		onApproveToolCall,
		onDenyToolCall,
	}: {
		parts: MessagePart[];
		onApproveToolCall: (approvalId: string) => void;
		onDenyToolCall: (approvalId: string) => void;
	} = $props();

	let thinkingExpanded = $state(false);
</script>

{#snippet mediaPart(label: string)}
	<div class="py-1 text-xs text-muted-foreground italic">{label}</div>
{/snippet}

{#each parts as part, i (`${part.type}-${i}`)}
	{#if part.type === 'text'}
		<p class="whitespace-pre-wrap text-sm">{part.content}</p>
	{:else if part.type === 'tool-call'}
		<ToolCallPart {part} {onApproveToolCall} {onDenyToolCall} />
	{:else if part.type === 'tool-result'}
		<ToolResultPart part={part as ToolResultPartType} />
	{:else if part.type === 'thinking'}
		<div class="my-1">
			<button
				class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				onclick={() => (thinkingExpanded = !thinkingExpanded)}
			>
				<ChevronRightIcon
					class="size-3 transition-transform {thinkingExpanded ? 'rotate-90' : ''}"
				/>
				<BrainIcon class="size-3" />
				Thinking…
			</button>
			{#if thinkingExpanded}
				<div
					class="mt-1 rounded bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap"
				>
					{(part as { type: 'thinking'; content: string }).content}
				</div>
			{/if}
		</div>
	{:else if part.type === 'image'}
		{@render mediaPart('[Image content]')}
	{:else if part.type === 'audio'}
		{@render mediaPart('[Audio content]')}
	{:else if part.type === 'video'}
		{@render mediaPart('[Video content]')}
	{:else if part.type === 'document'}
		{@render mediaPart('[Document content]')}
	{/if}
{/each}
