<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		CommandPalette,
		type CommandPaletteItem,
	} from '@epicenter/ui/command-palette';
	import { ConfirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import { Kbd } from '@epicenter/ui/kbd';
	import * as Resizable from '@epicenter/ui/resizable';
	import { Toaster } from '@epicenter/ui/sonner';
	import * as Tooltip from '@epicenter/ui/tooltip';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import { ModeWatcher } from 'mode-watcher';
	import { WorkspaceGate } from '@epicenter/svelte/workspace-gate';
	import { workspace } from '$lib/client';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import EntriesSidebar from '$lib/components/EntriesSidebar.svelte';
	import { entriesState } from '$lib/entries.svelte';
	import '@epicenter/ui/app.css';

	let { children } = $props();

	// ─── Command Palette ─────────────────────────────────────────────────────────

	let paletteOpen = $state(false);
	let paletteQuery = $state('');

	const paletteItems = $derived.by((): CommandPaletteItem[] => {
		if (!paletteOpen) return [];
		return entriesState.active.map((entry) => ({
			id: entry.id,
			label: entry.title || 'Untitled',
			description: entry.subtitle || undefined,
			icon: FileTextIcon,
			keywords: [...entry.tags, ...entry.type],
			group: entry.type.length > 0 ? entry.type[0] : 'Uncategorized',
			onSelect: () => goto(`/entries/${entry.id}`),
		}));
	});
</script>

<svelte:head><title>Fuji</title></svelte:head>

<svelte:window
	onkeydown={(event) => {
		const isInputFocused =
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable);

		if (event.key === 'k' && event.metaKey) {
			event.preventDefault();
			paletteOpen = !paletteOpen;
			return;
		}

		if (event.key === 'n' && event.metaKey) {
			event.preventDefault();
			entriesState.createEntry();
			return;
		}

		if (event.key === 'Escape' && !isInputFocused && page.url.pathname !== '/') {
			event.preventDefault();
			goto('/');
		}
	}}
/>

<WorkspaceGate whenReady={workspace.whenReady}>
	<Tooltip.Provider>
		<div class="flex h-screen flex-col">
			<AppHeader onOpenSearch={() => (paletteOpen = true)} />
			<Resizable.PaneGroup direction="horizontal" class="flex-1">
				<Resizable.Pane defaultSize={20} minSize={15} maxSize={40}>
				<EntriesSidebar />
				</Resizable.Pane>
				<Resizable.Handle withHandle />
				<Resizable.Pane defaultSize={80}>
					{@render children()}
				</Resizable.Pane>
			</Resizable.PaneGroup>
			<div class="flex h-7 shrink-0 items-center gap-3 border-t bg-background px-3 text-xs text-muted-foreground">
				<span>{entriesState.active.length} {entriesState.active.length === 1 ? 'entry' : 'entries'}</span>
				<div class="ml-auto flex items-center gap-1.5">
					<span class="flex items-center gap-1">
						Search <Kbd>⌘K</Kbd>
					</span>
				</div>
			</div>
		</div>
	</Tooltip.Provider>
</WorkspaceGate>

<CommandPalette
	items={paletteItems}
	bind:open={paletteOpen}
	bind:value={paletteQuery}
	placeholder="Search entries…"
	emptyMessage="No entries found."
	title="Search Entries"
	description="Search entries by title, subtitle, tags, or type"
/>

<Toaster offset={16} closeButton />
<ConfirmationDialog />
<ModeWatcher defaultMode="dark" track={false} />
