<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sidebar from '@epicenter/ui/sidebar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import HashIcon from '@lucide/svelte/icons/hash';
	import TagIcon from '@lucide/svelte/icons/tag';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { VList } from 'virtua/svelte';
	import { format, isToday, isYesterday } from 'date-fns';
	import { DateTimeString } from '@epicenter/workspace';
	import { entriesState, matchesEntrySearch, viewState } from '$lib/entries.svelte';

	const isSearching = $derived(viewState.searchQuery.trim().length > 0);

	/** Entries matching the search query across title, subtitle, tags, and type. */
	const searchResults = $derived.by(() => {
		if (!isSearching) return [];
		return entriesState.active.filter((entry) => matchesEntrySearch(entry, viewState.searchQuery));
	});

	/** Unique types with entry counts, sorted by count descending. */
	const typeGroups = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const entry of entriesState.active) {
			for (const t of entry.type) {
				counts.set(t, (counts.get(t) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name, count]) => ({ name, count }));
	});

	/** Unique tags with entry counts, sorted by count descending. */
	const tagGroups = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const entry of entriesState.active) {
			for (const tag of entry.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name, count]) => ({ name, count }));
	});

	/** Recent entries sorted by updatedAt, limited to 10. */
	const recentEntries = $derived(
		[...entriesState.active]
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, 10),
	);

	function getDateLabel(dts: string): string {
		const date = DateTimeString.toDate(dts);
		if (isToday(date)) return 'Today';
		if (isYesterday(date)) return 'Yesterday';
		return format(date, 'MMM d');
	}
</script>

<Sidebar.Root collapsible="none" class="h-full w-full">
	<Sidebar.Header>
		<div>
			<Sidebar.Input
				placeholder="Search entries…"
				value={viewState.searchQuery}
				oninput={(e) => (viewState.searchQuery = e.currentTarget.value)}
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
						isActive={page.url.pathname === '/' && !isSearching}
						onclick={() => goto('/')}
					>
							<FileTextIcon class="size-4" />
							<span>All Entries</span>
							<span class="ml-auto text-xs text-muted-foreground">
						{entriesState.active.length}
							</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={page.url.pathname === '/trash'}
							onclick={() => goto('/trash')}
						>
							<Trash2Icon class="size-4" />
							<span>Recently Deleted</span>
							{#if entriesState.deleted.length > 0}
								<span class="ml-auto text-xs text-muted-foreground">
									{entriesState.deleted.length}
								</span>
							{/if}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		{#if isSearching}
			<!-- Search Results -->
			<Sidebar.Group class="flex min-h-0 flex-1 flex-col">
				<Sidebar.GroupLabel>
					Search Results ({searchResults.length})
				</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
					{#if searchResults.length > 0}
					<div class="min-h-0 flex-1">
							<VList
								data={searchResults}
							style="height: 100%; overflow: hidden;"
								getKey={(entry) => entry.id}
							>
								{#snippet children(entry)}
									<Sidebar.MenuItem>
										<Sidebar.MenuButton size="lg" onclick={() => goto(`/entries/${entry.id}`)}>
										<div class="flex w-full flex-col gap-1 overflow-hidden">
												<span class="truncate text-sm font-medium">
													{entry.title || 'Untitled'}
												</span>
												{#if entry.subtitle}
													<span class="truncate text-xs text-muted-foreground">
														{entry.subtitle}
													</span>
												{/if}
											</div>
										</Sidebar.MenuButton>
									</Sidebar.MenuItem>
								{/snippet}
							</VList>
						</div>
						{:else}
							<Sidebar.MenuItem>
								<span class="px-2 py-1 text-xs text-muted-foreground">
								No entries match "{viewState.searchQuery}"
								</span>
							</Sidebar.MenuItem>
						{/if}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{:else}
			<!-- Type Groups -->
			{#if typeGroups.length > 0}
				<Sidebar.Group>
					<Sidebar.GroupLabel>Type</Sidebar.GroupLabel>
					<Sidebar.GroupContent>
						<Sidebar.Menu>
							{#each typeGroups as group (group.name)}
								<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={page.url.pathname === `/type/${encodeURIComponent(group.name)}`}
								onclick={() => goto(`/type/${encodeURIComponent(group.name)}`)}
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
								isActive={page.url.pathname === `/tag/${encodeURIComponent(group.name)}`}
								onclick={() => goto(`/tag/${encodeURIComponent(group.name)}`)}
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
								<Sidebar.MenuButton size="lg" onclick={() => goto(`/entries/${entry.id}`)}>
										<div class="flex w-full flex-col gap-1 overflow-hidden">
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
		{/if}
	</Sidebar.Content>

</Sidebar.Root>
