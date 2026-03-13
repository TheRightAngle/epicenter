<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';

	let { items }: { items: string[] } = $props();
</script>

<div class="flex flex-wrap gap-1">
	{#each items as item (item)}
		<Badge variant="secondary">{item}</Badge>
	{/each}
</div>
