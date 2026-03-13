<script lang="ts">
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import { ModeWatcher, mode } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import { queryClient } from '$lib/query/client';
	import '@epicenter/ui/app.css';
	import * as Tooltip from '@epicenter/ui/tooltip';

	let { children } = $props();
</script>

<svelte:head><title>Honeycrisp</title></svelte:head>

<QueryClientProvider client={queryClient}>
	<Tooltip.Provider>{@render children()}</Tooltip.Provider>
</QueryClientProvider>

<Toaster offset={16} theme={mode.current} richColors closeButton />
<ModeWatcher defaultMode="dark" track={false} />
<SvelteQueryDevtools client={queryClient} buttonPosition="bottom-right" />
