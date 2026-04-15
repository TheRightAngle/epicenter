<!--
	Render gate that blocks children until a workspace `whenReady` promise resolves.

	Uses `Empty.*` for both loading and error states to keep the structure symmetric.
	Both states are overridable via optional snippets.

	@example
	```svelte
	<script lang="ts">
		import { WorkspaceGate } from '@epicenter/svelte/workspace-gate';
		import workspace from '$lib/workspace';
	</script>

	<WorkspaceGate whenReady={workspace.whenReady}>
		<AppShell />
	</WorkspaceGate>
	```
-->
<script lang="ts">
	import * as Empty from '@epicenter/ui/empty';
	import { Spinner } from '@epicenter/ui/spinner';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';

	let {
		whenReady,
		children,
		loading,
		error,
	}: {
		/** Promise that resolves when the workspace is ready to read. */
		whenReady: Promise<unknown>;
		/** Optional override for the loading state. Defaults to Empty with a centered spinner. */
		loading?: Snippet;
		/** Optional override for the error state. Defaults to Empty with a warning icon. */
		error?: Snippet<[unknown]>;
	} = $props();
</script>

{#await whenReady}
	{#if loading}
		{@render loading()}
	{:else}
		<Empty.Root class="min-h-screen border-none">
			<Empty.Media>
				<Spinner class="size-5 text-muted-foreground" />
			</Empty.Media>
		</Empty.Root>
	{/if}
{:then _}
	{@render children()}
{:catch err}
	{#if error}
		{@render error(err)}
	{:else}
		<Empty.Root class="min-h-screen border-none">
			<Empty.Media>
				<TriangleAlertIcon class="size-8 text-muted-foreground" />
			</Empty.Media>
			<Empty.Title>Failed to load workspace</Empty.Title>
			<Empty.Description>
				Something went wrong initializing the workspace. Try refreshing the
				page.
			</Empty.Description>
		</Empty.Root>
	{/if}
{/await}
