<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as DropdownMenu from '@epicenter/ui/dropdown-menu';
	import * as ScrollArea from '@epicenter/ui/scroll-area';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { notesState, viewState } from '$lib/state';
	import { getDateLabel } from '$lib/utils/date';
	import type { Note } from '$lib/workspace';

	let {
		notes,
		title,
		showControls = true,
		emptyMessage = 'No notes yet. Click + to create one.',
	}: {
		notes: Note[];
		title: string;
		showControls?: boolean;
		emptyMessage?: string;
	} = $props();

	const sortOptions = [
		{ value: 'dateEdited' as const, label: 'Date Edited' },
		{ value: 'dateCreated' as const, label: 'Date Created' },
		{ value: 'title' as const, label: 'Title' },
	];

	const groupedNotes = $derived.by(() => {
		const pinned = notes
			.filter((n) => n.pinned)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		const unpinned = notes
			.filter((n) => !n.pinned)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		const groups: { label: string; entries: Note[] }[] = [];

		if (pinned.length > 0) {
			groups.push({ label: 'Pinned', entries: pinned });
		}

		let currentLabel = '';
		let currentGroup: Note[] = [];

		for (const note of unpinned) {
			const label = getDateLabel(note.updatedAt);
			if (label !== currentLabel) {
				if (currentGroup.length > 0) {
					groups.push({ label: currentLabel, entries: currentGroup });
				}
				currentLabel = label;
				currentGroup = [note];
			} else {
				currentGroup.push(note);
			}
		}

		if (currentGroup.length > 0) {
			groups.push({ label: currentLabel, entries: currentGroup });
		}

		return groups;
	});

	/** Flat list of note IDs in display order for arrow key navigation. */
	const flatNoteIds = $derived(
		groupedNotes.flatMap((g) => g.entries.map((n) => n.id)),
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full flex-col"
	onkeydown={(e) => {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		if (flatNoteIds.length === 0) return;
		e.preventDefault();

		const currentIndex = viewState.selectedNoteId
			? flatNoteIds.indexOf(viewState.selectedNoteId)
			: -1;

		if (e.key === 'ArrowDown') {
			const nextIndex =
				currentIndex < flatNoteIds.length - 1 ? currentIndex + 1 : 0;
			viewState.selectNote(flatNoteIds[nextIndex]!);
		} else {
			const prevIndex =
				currentIndex > 0 ? currentIndex - 1 : flatNoteIds.length - 1;
			viewState.selectNote(flatNoteIds[prevIndex]!);
		}
	}}
	tabindex="-1"
>
	<div class="flex items-center justify-between border-b px-4 py-3">
		<div class="flex items-center gap-2">
			<h2 class="text-sm font-semibold">{title}</h2>
			<span class="text-xs text-muted-foreground">{notes.length}</span>
		</div>
		{#if showControls}
			<div class="flex items-center gap-1">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button variant="ghost" size="icon" class="size-7" {...props}>
								<ArrowUpDownIcon class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-44">
						{#each sortOptions as option}
							<DropdownMenu.Item
								onclick={() => viewState.setSortBy(option.value)}
							>
								{#if viewState.sortBy === option.value}
									<CheckIcon class="mr-2 size-4" />
								{:else}
									<span class="mr-2 size-4"></span>
								{/if}
								{option.label}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Button
					variant="ghost"
					size="icon"
					class="size-7"
					onclick={() => {
						const { id } = notesState.createNote(viewState.selectedFolderId);
						viewState.selectNote(id);
					}}
				>
					<PlusIcon class="size-4" />
				</Button>
			</div>
		{/if}
	</div>

	<ScrollArea.Root class="flex-1">
		{#if notes.length === 0}
			<div
				class="flex h-full items-center justify-center p-8 text-center text-muted-foreground"
			>
				<p class="text-sm">{emptyMessage}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-4 p-2">
				{#each groupedNotes as group}
					<div class="flex flex-col gap-0.5">
						<h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">
							{group.label}
						</h3>
						{#each group.entries as note (note.id)}
							<NoteCard
								{note}
								isSelected={note.id === viewState.selectedNoteId}
								onSelect={() => viewState.selectNote(note.id)}
							/>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</ScrollArea.Root>
</div>
