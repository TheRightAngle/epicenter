<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { Textarea } from '@epicenter/ui/textarea';
	import SendIcon from '@lucide/svelte/icons/send';
	import SquareIcon from '@lucide/svelte/icons/square';
	import type { ConversationHandle } from '$lib/chat/chat-state.svelte';
	import { aiChatState } from '$lib/chat/chat-state.svelte';
	import ModelCombobox from './ModelCombobox.svelte';
	import ProviderSelect from './ProviderSelect.svelte';

	let {
		active,
	}: {
		active: ConversationHandle | undefined;
	} = $props();

	const models = $derived(
		aiChatState.modelsForProvider(active?.provider ?? ''),
	);

	function send() {
		if (!active) return;
		const content = active.inputValue.trim();
		if (!content) return;
		active.inputValue = '';
		active.sendMessage(content);
	}
</script>

<div class="flex flex-col gap-1.5 border-t bg-background px-2 py-1.5">
	<!-- Provider + Model selects -->
	<div class="flex gap-2">
		<ProviderSelect
			value={active?.provider ?? ''}
			providers={aiChatState.availableProviders}
			onValueChange={(v) => {
				if (active) active.provider = v;
			}}
		/>

		<ModelCombobox
			class="flex-1"
			value={active?.model ?? ''}
			{models}
			onSelect={(m) => {
				if (active) active.model = m;
			}}
		/>
	</div>

	<!-- Input + send/stop button -->
	<form
		class="flex items-end gap-1.5"
		aria-label="Chat message"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		{#if active}
			<Textarea
				class="min-h-0 max-h-32 flex-1 resize-none overflow-y-auto"
				rows={1}
				placeholder="Type a message…"
				bind:value={active.inputValue}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						send();
					}
				}}
			/>
		{/if}
		{#if active?.isLoading}
			<Button
				variant="outline"
				size="icon-lg"
				type="button"
				onclick={() => active?.stop()}
			>
				<SquareIcon />
			</Button>
		{:else}
			<Button
				variant="default"
				size="icon-lg"
				type="submit"
				disabled={!active?.inputValue.trim()}
			>
				<SendIcon />
			</Button>
		{/if}
	</form>
</div>
