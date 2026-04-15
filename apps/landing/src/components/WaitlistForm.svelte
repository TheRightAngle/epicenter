<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { cn } from '@epicenter/ui/utils';

	const DISCORD_URL = 'https://go.epicenter.so/discord';

	type Props = {
		class?: string;
	};

	let { class: className }: Props = $props();
</script>

<div class={cn('space-y-6 text-center', className)}>
	<div class="space-y-2">
		<h3 class="text-2xl font-semibold text-foreground">
			Want to stay in the loop?
		</h3>
		<p class="text-muted-foreground">
			Join our Discord to get early access and help shape what we build.
		</p>
	</div>

	<Button href={DISCORD_URL} target="_blank" rel="noreferrer" class="w-full">
		Join Discord
	</Button>
</div>
