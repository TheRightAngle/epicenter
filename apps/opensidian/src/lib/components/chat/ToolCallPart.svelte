<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';
	import { Button } from '@epicenter/ui/button';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import type { ToolCallPart as TanStackToolCallPart } from '@tanstack/ai-client';
	import type { WorkspaceTools } from '$lib/client';

	let {
		part,
		onApproveToolCall,
		onDenyToolCall,
	}: {
		part: TanStackToolCallPart<WorkspaceTools>;
		onApproveToolCall: (approvalId: string) => void;
		onDenyToolCall: (approvalId: string) => void;
	} = $props();

	const isRunning = $derived(part.output == null);
	const isFailed = $derived(
		typeof part.output === 'object' &&
			part.output !== null &&
			'error' in part.output,
	);
	const isApprovalRequested = $derived(part.state === 'approval-requested');
	const approval = $derived(part.approval);

	const displayName = $derived(
		part.name
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' '),
	);

	const badgeVariant = $derived.by(() => {
		if (isFailed) return 'status.failed' as const;
		if (isRunning) return 'status.running' as const;
		return 'status.completed' as const;
	});
</script>

{#snippet codeBlock(text: string)}
	<pre
		class="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px]"
	>{text}</pre>
{/snippet}

<div class="flex flex-col gap-1 py-1">
	<div class="flex items-center gap-1.5">
		{#if isApprovalRequested}
			<ShieldAlertIcon class="size-3 text-amber-500" />
		{:else if isRunning}
			<LoaderCircleIcon class="size-3 animate-spin text-blue-500" />
		{:else}
			<WrenchIcon class="size-3 text-muted-foreground" />
		{/if}
		<Badge variant={isApprovalRequested ? 'secondary' : badgeVariant}>
			{displayName}{isRunning && !isApprovalRequested ? '…' : ''}
		</Badge>
	</div>

	{#if isApprovalRequested}
		<div class="flex items-center gap-1.5 pl-[1.125rem]">
			<Button
				variant="outline"
				size="sm"
				onclick={() => {
					if (approval?.id) onApproveToolCall(approval.id);
				}}
			>
				Allow
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="text-muted-foreground"
				onclick={() => {
					if (approval?.id) onDenyToolCall(approval.id);
				}}
			>
				Deny
			</Button>
		</div>
	{/if}

	<details class="pl-[1.125rem]">
		<summary
			class="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
		>
			Details
		</summary>
		<div class="mt-1 rounded-md bg-muted/50 p-2 text-xs">
			{#if part.arguments}
				<div class="mb-1">
					<span class="font-medium text-muted-foreground">Arguments:</span>
					{@render codeBlock(part.arguments)}
				</div>
			{/if}
			{#if part.output != null}
				<div>
					<span class="font-medium text-muted-foreground">Result:</span>
					{@render codeBlock(
						typeof part.output === 'string'
							? part.output
							: JSON.stringify(part.output, null, 2),
					)}
				</div>
			{/if}
		</div>
	</details>
</div>
