<script lang="ts">
	import type { FileId } from '@epicenter/filesystem';
	import { Badge } from '@epicenter/ui/badge';
	import * as Collapsible from '@epicenter/ui/collapsible';
	import { cn } from '@epicenter/ui/utils';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import { fsState } from '$lib/state/fs-state.svelte';
	import type { FileGroup } from '$lib/state/sidebar-search-state.svelte';

	let {
		group,
		defaultOpen = true,
	}: {
		group: FileGroup;
		defaultOpen?: boolean;
	} = $props();

	let open = $derived(defaultOpen);

	/**
	 * Strip all HTML tags except <mark> for safe snippet rendering.
	 */
	function sanitizeSnippet(html: string): string {
		return html.replace(/<(?!\/?mark\b)[^>]*>/gi, '');
	}

	function handleMatchClick(fileId: string) {
		fsState.selectFile(fileId as FileId);
	}

	const displayPath = $derived(
		group.filePath
			? group.filePath.slice(1, group.filePath.lastIndexOf('/')) || ''
			: '',
	);
</script>

<Collapsible.Root bind:open>
	<Collapsible.Trigger
		class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
	>
		<ChevronRightIcon
			class={cn(
				'size-4 shrink-0 text-muted-foreground transition-transform',
				open && 'rotate-90',
			)}
		/>
		<FileTextIcon class="size-4 shrink-0 text-muted-foreground" />
		<span class="truncate font-medium">{group.fileName}</span>
		{#if displayPath}
			<span class="truncate text-xs text-muted-foreground">{displayPath}</span>
		{/if}
		<Badge variant="outline" class="ml-auto shrink-0 text-xs">
			{group.matchCount}
		</Badge>
	</Collapsible.Trigger>

	<Collapsible.Content>
		<div class="ml-6 border-l border-border pl-3">
			{#each group.matches as match, i (i)}
				<button
					type="button"
					class="block w-full cursor-pointer rounded-sm px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
					onclick={() => handleMatchClick(group.fileId)}
				>
					<span class="line-clamp-2 break-all text-xs">
						{@html sanitizeSnippet(match.snippet)}
					</span>
				</button>
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
