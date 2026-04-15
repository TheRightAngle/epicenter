<script lang="ts">
	import { Skeleton } from '@epicenter/ui/skeleton';
	import * as Table from '@epicenter/ui/table';
	import { createQuery } from '@tanstack/svelte-query';
	import { modelsQuery } from '$lib/query/billing';

	const models = createQuery(() => modelsQuery.options);

	/** Sorted model entries: cheapest first, then alphabetical. */
	const sortedModels = $derived(
		Object.entries((models.data?.credits ?? {}) as Record<string, number>).sort(
			([aName, aCost], [bName, bCost]) =>
				aCost - bCost || aName.localeCompare(bName),
		),
	);

	/**
	 * Extract provider from model name heuristic.
	 * Models starting with 'gpt'/'o' are OpenAI, 'claude' is Anthropic,
	 * 'gemini' is Google, 'grok' is xAI.
	 */
	function getProvider(model: string): string {
		if (
			model.startsWith('gpt') ||
			model.startsWith('o1') ||
			model.startsWith('o3') ||
			model.startsWith('o4') ||
			model.startsWith('computer-use') ||
			model.startsWith('chatgpt') ||
			model.startsWith('codex')
		)
			return 'OpenAI';
		if (model.startsWith('claude')) return 'Anthropic';
		if (model.startsWith('gemini')) return 'Google';
		if (model.startsWith('grok')) return 'xAI';
		return 'Unknown';
	}
</script>

{#if models.isPending}
	<div class="space-y-2">
		{#each Array(10) as _}
			<Skeleton class="h-8 w-full" />
		{/each}
	</div>
{:else if models.isError}
	<p class="text-sm text-destructive">Failed to load model costs.</p>
{:else}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Model</Table.Head>
				<Table.Head>Provider</Table.Head>
				<Table.Head class="text-right">Credits/call</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each sortedModels as [ model, credits ]}
				<Table.Row>
					<Table.Cell class="font-mono text-xs">{model}</Table.Cell>
					<Table.Cell class="text-muted-foreground text-xs"
						>{getProvider(model)}</Table.Cell
					>
					<Table.Cell class="text-right tabular-nums">{credits}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
