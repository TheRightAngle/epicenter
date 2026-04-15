<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import { Button } from '#/button';
	import * as Command from '#/command';
	import { useCombobox } from '#/hooks';
	import * as Popover from '#/popover';
	import { cn } from '#/utils';

	let {
		value = $bindable(),
		disabled = false,
	}: {
		value: string;
		disabled?: boolean;
	} = $props();

	const combobox = useCombobox();
	const now = new Date();
	const timeZoneOptions = Intl.supportedValuesOf('timeZone').map((timeZone) => {
		const offset =
			new Intl.DateTimeFormat('en-US', {
				timeZone,
				timeZoneName: 'shortOffset',
			})
				.formatToParts(now)
				.find((part) => part.type === 'timeZoneName')
				?.value.replace(/^GMT/, 'UTC') ?? 'UTC';

		return {
			timeZone,
			offset,
			label: `${timeZone} (${offset})`,
			keywords: [
				timeZone,
				timeZone.replaceAll('/', ' '),
				timeZone.replaceAll('_', ' '),
				offset,
			],
		};
	});

	const selectedTimeZone = $derived(
		timeZoneOptions.find((timeZoneOption) => timeZoneOption.timeZone === value),
	);
	const triggerLabel = $derived(
		selectedTimeZone?.label ?? 'Select timezone',
	);
</script>

<Popover.Root bind:open={combobox.open}>
	<Popover.Trigger bind:ref={combobox.triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				{disabled}
				variant="outline"
				role="combobox"
				aria-expanded={combobox.open}
				class={cn(
					'w-full justify-between gap-2 font-normal',
					!selectedTimeZone && 'text-muted-foreground',
				)}
			>
				<span class="truncate text-left">{triggerLabel}</span>
				<ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>

	<Popover.Content
		align="start"
		class="w-[--bits-popover-anchor-width] min-w-[20rem] p-0"
	>
		<Command.Root>
			<Command.Input placeholder="Search timezones..." />
			<Command.List class="max-h-72">
				<Command.Empty>No timezone found.</Command.Empty>

				{#each timeZoneOptions as timeZoneOption (timeZoneOption.timeZone)}
					<Command.Item
						value={timeZoneOption.label}
						keywords={timeZoneOption.keywords}
						onSelect={() => {
							value = timeZoneOption.timeZone;
							combobox.closeAndFocusTrigger();
						}}
					>
						<CheckIcon
							class={cn(
								'size-4 shrink-0',
								value === timeZoneOption.timeZone ? 'opacity-100' : 'opacity-0',
							)}
						/>
						<span class="truncate">{timeZoneOption.label}</span>
					</Command.Item>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
