<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as DropdownMenu from '@epicenter/ui/dropdown-menu';
	import * as ScrollArea from '@epicenter/ui/scroll-area';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { format, isToday, isYesterday } from 'date-fns';
	import type { Note, NoteId } from '$lib/workspace';

	let {
		notes,
		selectedNoteId,
		sortBy,
		onSelectNote,
		onCreateNote,
		onDeleteNote,
		onPinNote,
		onSortChange,
	}: {
		notes: Note[];
		selectedNoteId: NoteId | null;
		sortBy: 'dateEdited' | 'dateCreated' | 'title';
		onSelectNote: (noteId: NoteId) => void;
		onCreateNote: () => void;
		onDeleteNote: (noteId: NoteId) => void;
		onPinNote: (noteId: NoteId) => void;
		onSortChange: (sortBy: 'dateEdited' | 'dateCreated' | 'title') => void;
	} = $props();

	function parseDateTime(dts: string): Date {
		return new Date(dts.split('|')[0]!);
	}

	function getDateLabel(dts: string): string {
		const date = parseDateTime(dts);
		if (isToday(date)) return 'Today';
		if (isYesterday(date)) return 'Yesterday';
		return format(date, 'MMMM d');
	}

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
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b px-4 py-3">
		<h2 class="text-sm font-semibold">Notes</h2>
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
					<DropdownMenu.Item onclick={() => onSortChange('dateEdited')}>
						{#if sortBy === 'dateEdited'}
							<CheckIcon class="mr-2 size-4" />
						{:else}
							<span class="mr-2 size-4"></span>
						{/if}
						Date Edited
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => onSortChange('dateCreated')}>
						{#if sortBy === 'dateCreated'}
							<CheckIcon class="mr-2 size-4" />
						{:else}
							<span class="mr-2 size-4"></span>
						{/if}
						Date Created
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => onSortChange('title')}>
						{#if sortBy === 'title'}
							<CheckIcon class="mr-2 size-4" />
						{:else}
							<span class="mr-2 size-4"></span>
						{/if}
						Title
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Button variant="ghost" size="icon" class="size-7" onclick={onCreateNote}>
				<PlusIcon class="size-4" />
			</Button>
		</div>
	</div>

	<ScrollArea.Root class="flex-1">
		{#if notes.length === 0}
			<div
				class="flex h-full items-center justify-center p-8 text-center text-muted-foreground"
			>
				<p class="text-sm">No notes yet. Click + to create one.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-4 p-2">
				{#each groupedNotes as group}
					<div class="flex flex-col gap-0.5">
						<h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">
							{group.label}
						</h3>
						{#each group.entries as note (note.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="group relative flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/50 {selectedNoteId ===
								note.id
									? 'bg-accent'
									: ''}"
								onclick={() => onSelectNote(note.id)}
							>
								<div class="flex items-start justify-between gap-2">
									<span class="font-medium line-clamp-1">
										{#if note.pinned}
											<PinIcon
												class="mr-1 inline size-3 fill-current align-baseline"
											/>
										{/if}
										{note.title || 'Untitled'}
									</span>
									<span class="shrink-0 text-xs text-muted-foreground">
										{format(parseDateTime(note.updatedAt), 'h:mm a')}
									</span>
								</div>
								<p class="line-clamp-2 text-xs text-muted-foreground">
									{note.preview || 'No content'}
								</p>

								<div
									class="absolute right-2 top-2 hidden items-center gap-0.5 group-hover:flex {selectedNoteId ===
									note.id
										? 'flex'
										: ''}"
								>
									<Button
										variant="ghost"
										size="icon"
										class="size-6"
										onclick={(e) => {
											e.stopPropagation();
											onPinNote(note.id);
										}}
									>
										<PinIcon
											class="size-3 {note.pinned ? 'fill-current' : ''}"
										/>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 text-destructive hover:text-destructive"
										onclick={(e) => {
											e.stopPropagation();
											onDeleteNote(note.id);
										}}
									>
										<TrashIcon class="size-3" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</ScrollArea.Root>
</div>
