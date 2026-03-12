<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import XIcon from '@lucide/svelte/icons/x';
	import { scale } from 'svelte/transition';
	import { buttonVariants } from '#/button';
	import { UseClipboard } from '#/hooks/use-clipboard.svelte';
	import { cn } from '#/utils.js';
	import type { CopyButtonProps } from './types';

	let {
		ref = $bindable(null),
		text,
		icon,
		animationDuration = 500,
		variant = 'ghost',
		size = 'icon',
		onCopy,
		copyFn,
		class: className,
		tabindex = -1,
		children,
		...rest
	}: CopyButtonProps = $props();

	// svelte-ignore state_referenced_locally - intentional one-time size adjustment based on initial children
	if (size === 'icon' && children) {
		size = 'default';
	}

	// svelte-ignore state_referenced_locally - clipboard instance created once with initial copyFn
	const clipboard = new UseClipboard({ copyFn });
</script>

<button
	{...rest}
		bind:this={ref}
	{tabindex}
	class={cn(buttonVariants({ variant, size }), 'flex items-center gap-2', className)}
	type="button"
	name="copy"
	onclick={async () => {
		const status = await clipboard.copy(text);

		onCopy?.(status);
	}}
>
	{#if clipboard.status === 'success'}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			<CheckIcon tabindex={-1} />
			<span class="sr-only">Copied</span>
		</div>
	{:else if clipboard.status === 'failure'}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			<XIcon tabindex={-1} />
			<span class="sr-only">Failed to copy</span>
		</div>
	{:else}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			{#if icon}
				{@render icon()}
			{:else}
				<CopyIcon tabindex={-1} />
			{/if}
			<span class="sr-only">Copy</span>
		</div>
	{/if}
	{@render children?.()}
</button>
