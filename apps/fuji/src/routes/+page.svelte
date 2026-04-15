<script lang="ts">
	import EntriesTable from '$lib/components/EntriesTable.svelte';
	import EntriesTimeline from '$lib/components/EntriesTimeline.svelte';
	import { entriesState, viewState } from '$lib/entries.svelte';
</script>

{#if viewState.viewMode === 'table'}
	<EntriesTable entries={entriesState.active} />
{:else}
	<EntriesTimeline entries={entriesState.active} />
{/if}
