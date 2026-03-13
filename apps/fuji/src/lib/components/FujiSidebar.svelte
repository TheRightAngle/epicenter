<script lang="ts">
	import * as Sidebar from '@epicenter/ui/sidebar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import HashIcon from '@lucide/svelte/icons/hash';
	import TagIcon from '@lucide/svelte/icons/tag';
	import { format, isToday, isYesterday } from 'date-fns';
	import type { Entry, EntryId } from '$lib/workspace';

	let {
		entries,
		activeTypeFilter,
		activeTagFilter,
		searchQuery,
		onFilterByType,
		onFilterByTag,
		onSearchChange,
		onSelectEntry,
	}: {
		entries: Entry[];
		activeTypeFilter: string | null;
		activeTagFilter: string | null;
		searchQuery: string;
		onFilterByType: (type: string | null) => void;
		onFilterByTag: (tag: string | null) => void;
		onSearchChange: (query: string) => void;
		onSelectEntry: (id: EntryId) => void;
	} = $props();

	/** Unique types with entry counts, sorted by count descending. */
	const typeGroups = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const entry of entries) {
			if (entry.type) {
				for (const t of entry.type) {
					counts.set(t, (counts.get(t) ?? 0) + 1);
				}
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name, count]) => ({ name, count }));
	});

	/** Unique tags with entry counts, sorted by count descending. */
	const tagGroups = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const entry of entries) {
			if (entry.tags) {
				for (const tag of entry.tags) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
				}
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name, count]) => ({ name, count }));
	});

	/** Recent entries sorted by updatedAt, limited to 10. */
	const recentEntries = $derived(
		[...entries]
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, 10),
	);

	function parseDateTime(dts: string): Date {
		return new Date(dts.split('|')[0]!);
	}

	function getDateLabel(dts: string): string {
		const date = parseDateTime(dts);
		if (isToday(date)) return 'Today';
		if (isYesterday(date)) return 'Yesterday';
		return format(date, 'MMM d');
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center justify-between px-2 py-1">
			<span class="text-sm font-semibold">Fuji</span>
		</div>
		<div class="px-2 pb-1">
			<Sidebar.Input
				placeholder="Search entries\u2026"
				value={searchQuery}
				oninput={(e) => onSearchChange(e.currentTarget.value)}
			/>
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<!-- All Entries -->
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={activeTypeFilter === null && activeTagFilter === null}
							onclick={() => {
								onFilterByType(null);
								onFilterByTag(null);
							}}
						>
							<FileTextIcon class="size-4" />
							<span>All Entries</span>
							<span class="ml-auto text-xs text-muted-foreground">
								{entries.length}
							</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<!-- Type Groups -->
		{#if typeGroups.length > 0}
			<Sidebar.Group>
				<Sidebar.GroupLabel>Type</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each typeGroups as group (group.name)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={activeTypeFilter === group.name}
									onclick={() =>
										onFilterByType(
											activeTypeFilter === group.name ? null : group.name,
										)}
								>
									<HashIcon class="size-4" />
									<span>{group.name}</span>
									<span class="ml-auto text-xs text-muted-foreground">
										{group.count}
									</span>
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}

		<!-- Tag Groups -->
		{#if tagGroups.length > 0}
			<Sidebar.Group>
				<Sidebar.GroupLabel>Tags</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each tagGroups as group (group.name)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={activeTagFilter === group.name}
									onclick={() =>
										onFilterByTag(
											activeTagFilter === group.name ? null : group.name,
										)}
								>
									<TagIcon class="size-4" />
									<span>{group.name}</span>
									<span class="ml-auto text-xs text-muted-foreground">
										{group.count}
									</span>
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}

		<!-- Recent Entries -->
		{#if recentEntries.length > 0}
			<Sidebar.Group>
				<Sidebar.GroupLabel>Recent</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each recentEntries as entry (entry.id)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton onclick={() => onSelectEntry(entry.id)}>
									<div class="flex w-full flex-col gap-0.5 overflow-hidden">
										<span class="truncate text-sm font-medium">
											{entry.title || 'Untitled'}
										</span>
										<span class="truncate text-xs text-muted-foreground">
											{getDateLabel(entry.updatedAt)}
										</span>
									</div>
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}
	</Sidebar.Content>

	<Sidebar.Rail />
</Sidebar.Root>
