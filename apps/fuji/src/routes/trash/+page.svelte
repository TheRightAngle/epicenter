<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { confirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import * as Empty from '@epicenter/ui/empty';
	import * as Table from '@epicenter/ui/table';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { workspace } from '$lib/client';
	import { entriesState } from '$lib/entries.svelte';
	import { relativeTime } from '$lib/format';

	const deletedEntries = $derived(
		[...entriesState.deleted].sort((a, b) =>
			(b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''),
		),
	);
</script>

<main class="flex h-full flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="flex items-center justify-between border-b px-4 py-2">
		<h2 class="text-sm font-semibold">Recently Deleted</h2>
	</div>

	{#if deletedEntries.length === 0}
		<Empty.Root class="flex-1">
			<Empty.Media>
				<Trash2Icon class="size-8 text-muted-foreground" />
			</Empty.Media>
			<Empty.Title>Trash is empty</Empty.Title>
			<Empty.Description>Deleted entries will appear here.</Empty.Description>
		</Empty.Root>
	{:else}
		<div class="flex-1 overflow-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Title</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head>Deleted</Table.Head>
						<Table.Head class="w-[100px]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each deletedEntries as entry (entry.id)}
						<Table.Row>
							<Table.Cell>
								<span class="font-medium">{entry.title || 'Untitled'}</span>
								{#if entry.subtitle}
									<span class="ml-2 text-muted-foreground"
										>{entry.subtitle}</span
									>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if entry.type.length > 0}
									<span class="text-muted-foreground"
										>{entry.type.join(', ')}</span
									>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if entry.deletedAt}
									<span class="text-muted-foreground"
										>{relativeTime(entry.deletedAt)}</span
									>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="icon-sm"
										title="Restore entry"
										onclick={() => {
										workspace.actions.entries.restore({ id: entry.id });
										goto(`/entries/${entry.id}`);
									}}
									>
										<RotateCcwIcon class="size-4" />
									</Button>
									<Button
										variant="ghost-destructive"
										size="icon-sm"
										title="Delete permanently"
										onclick={() => {
											confirmationDialog.open({
												title: 'Delete permanently?',
												description: `"${entry.title || 'Untitled'}" will be permanently removed. This cannot be undone.`,
												confirm: { text: 'Delete forever', variant: 'destructive' },
												onConfirm: () => {
													workspace.tables.entries.delete(entry.id);
												},
											});
										}}
									>
										<XIcon class="size-4" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</main>
