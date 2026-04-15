<script lang="ts">
	import '../app.css';
	import { Toaster } from '@epicenter/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<Toaster />
<ModeWatcher />
{@render children()}
