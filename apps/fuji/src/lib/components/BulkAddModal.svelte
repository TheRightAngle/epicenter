<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as Modal from '@epicenter/ui/modal';
	import { localTimezone } from '@epicenter/ui/natural-language-date-input';
	import { toast } from '@epicenter/ui/sonner';
	import { Textarea } from '@epicenter/ui/textarea';
	import { TimezoneCombobox } from '@epicenter/ui/timezone-combobox';
	import * as Tooltip from '@epicenter/ui/tooltip';
	import { DateTimeString } from '@epicenter/workspace';
	import ClipboardPasteIcon from '@lucide/svelte/icons/clipboard-paste';
	import { workspace } from '$lib/client';

	const LINE_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s(.+)$/;

	let isOpen = $state(false);
	let rawText = $state('');
	let timezone = $state(localTimezone());

	const parsed = $derived.by(() => {
		if (!rawText.trim()) return { entries: [], skipped: 0 };

		const lines = rawText.split('\n').filter((l) => l.trim());
		const matched = lines
			.map((line) => LINE_REGEX.exec(line))
			.filter((m) => m !== null);
		const entries = matched.map((m) => ({ iso: m[1]!, text: m[2]! }));
		return { entries, skipped: lines.length - entries.length };
	});

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (parsed.entries.length === 0) return;

		const items = parsed.entries.map(({ iso, text }) => ({
			title: text,
			date: DateTimeString.stringify(iso, timezone),
		}));
		workspace.actions.entries.bulkCreate({ entries: items });
		toast.success(
			`Added ${items.length} ${items.length === 1 ? 'entry' : 'entries'}`,
		);
		isOpen = false;
		rawText = '';
	}
</script>

<Modal.Root bind:open={isOpen}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon-sm"
					onclick={() => (isOpen = true)}
				>
					<ClipboardPasteIcon class="size-4" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>Bulk add entries</Tooltip.Content>
	</Tooltip.Root>
	<Modal.Content class="sm:max-w-lg">
		<Modal.Header>
			<Modal.Title>Bulk Add Entries</Modal.Title>
			<Modal.Description>
				Paste timestamped lines. Each line: ISO 8601 timestamp, then a space,
				then text.
			</Modal.Description>
		</Modal.Header>
		<form onsubmit={handleSubmit} class="flex flex-col gap-4">
			<Textarea
				bind:value={rawText}
				placeholder={"2026-04-08T12:39:54.844Z Your text here\n2026-04-08T13:01:22.000Z Another entry"}
				rows={8}
				class="font-mono text-xs"
			/>
			<div class="space-y-1.5">
				<label class="text-sm font-medium">Timezone</label>
				<TimezoneCombobox bind:value={timezone} />
			</div>
			{#if rawText.trim()}
				<p class="text-sm text-muted-foreground">
					{parsed.entries.length}
					{parsed.entries.length === 1 ? 'entry' : 'entries'}
					parsed
					{#if parsed.skipped > 0}
						, {parsed.skipped} skipped
					{/if}
				</p>
			{/if}
			<Modal.Footer>
				<Button variant="outline" type="button" onclick={() => (isOpen = false)}
					>Cancel</Button
				>
				<Button type="submit" disabled={parsed.entries.length === 0}>
					Add {parsed.entries.length}
					{parsed.entries.length === 1 ? 'entry' : 'entries'}
				</Button>
			</Modal.Footer>
		</form>
	</Modal.Content>
</Modal.Root>
