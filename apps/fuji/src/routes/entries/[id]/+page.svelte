<script lang="ts">
	import { page } from '$app/state';
	import * as Empty from '@epicenter/ui/empty';
	import { Spinner } from '@epicenter/ui/spinner';
	import FileXIcon from '@lucide/svelte/icons/file-x';
	import type { DocumentHandle } from '@epicenter/workspace';
	import type * as Y from 'yjs';
	import { workspace } from '$lib/client';
	import EntryEditor from '$lib/components/EntryEditor.svelte';
	import { entriesState } from '$lib/entries.svelte';
	import type { EntryId } from '$lib/workspace';

	const entryId = $derived(page.params.id as EntryId);
	const entry = $derived(entryId ? (entriesState.get(entryId) ?? null) : null);

	let currentYXmlFragment = $state<Y.XmlFragment | null>(null);
	let currentDocHandle = $state<DocumentHandle | null>(null);

	// Document lifecycle depends ONLY on entryId — not on entry metadata.
	//
	// Why: content edits bump `updatedAt` via the document's onUpdate callback,
	// which replaces the entry object in the SvelteMap. If this $effect tracked
	// `entry`, every keystroke in the OTHER tab would: change entry → re-run
	// effect → close document → null out fragment (flash spinner) → reopen
	// document → recreate ProseMirror. Two tabs amplify this into a loop because
	// each tab generates its own timestamp.
	//
	// The template still reads `entry` for display and the "not found" gate —
	// that's template reactivity, not effect reactivity, so it's safe.
	$effect(() => {
		if (!entryId) {
			currentYXmlFragment = null;
			currentDocHandle = null;
			return;
		}

		let cancelled = false;
		workspace.documents.entries.content.open(entryId).then((handle) => {
			if (cancelled) return;
			currentDocHandle = handle;
			currentYXmlFragment = handle.asRichText();
		});

		return () => {
			cancelled = true;
			if (currentDocHandle) {
				workspace.documents.entries.content.close(entryId);
			}
			currentYXmlFragment = null;
			currentDocHandle = null;
		};
	});
</script>

<main class="flex h-full flex-1 flex-col overflow-hidden">
	{#if !entry}
		<Empty.Root class="flex-1">
			<Empty.Media>
				<FileXIcon class="size-8 text-muted-foreground" />
			</Empty.Media>
			<Empty.Title>Entry not found</Empty.Title>
			<Empty.Description>This entry may have been deleted or the URL is invalid.</Empty.Description>
		</Empty.Root>
	{:else if currentYXmlFragment}
		{#key entryId}
			<EntryEditor {entry} yxmlfragment={currentYXmlFragment} />
		{/key}
	{:else}
		<div class="flex h-full items-center justify-center">
			<Spinner class="size-5 text-muted-foreground" />
		</div>
	{/if}
</main>
