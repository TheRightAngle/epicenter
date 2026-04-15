<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import XIcon from '@lucide/svelte/icons/x';
	import { aiChatState } from '$lib/chat/chat-state.svelte';
	import ChatInput from './ChatInput.svelte';
	import MessageList from './MessageList.svelte';

	const active = $derived(aiChatState.active);

	/** Tracks which error message was dismissed so it doesn't reappear. */
	let dismissedError = $state<string | null>(null);

	const errorVisible = $derived(
		active?.error && active.error.message !== dismissedError,
	);
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center justify-between border-b px-3 py-2">
		<h2 class="text-sm font-medium">AI Chat</h2>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				aiChatState.newConversation();
				dismissedError = null;
			}}
		>
			<SquarePenIcon class="size-3.5" />
			New Chat
		</Button>
	</div>

	<!-- Message list -->
	<div class="min-h-0 flex-1">
		<MessageList
			messages={active?.messages ?? []}
			status={active?.status ?? 'ready'}
			onReload={() => active?.reload()}
			onApproveToolCall={(id) => active?.approveToolCall(id)}
			onDenyToolCall={(id) => active?.denyToolCall(id)}
		/>
	</div>

	<!-- Error states: auth + credits are persistent (no dismiss), others are dismissable -->
	{#if active?.isUnauthorized}
		<div
			role="alert"
			class="flex items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			<span class="min-w-0 flex-1">Sign in to use AI Chat</span>
			<Button
				variant="ghost"
				size="sm"
				class="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
				onclick={() => {
					// TODO: open auth popover or navigate to sign-in
				}}
			>
				<LogInIcon class="size-3" />
				Sign In
			</Button>
		</div>
	{:else if active?.isCreditsExhausted}
		<div
			role="alert"
			class="flex items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			<span class="min-w-0 flex-1">You're out of credits</span>
			<Button
				variant="ghost"
				size="sm"
				class="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
				onclick={() => {
					// TODO: open billing / upgrade flow
				}}
			>
				Upgrade
			</Button>
		</div>
	{:else if errorVisible}
		<!-- Dismissable errors: model restriction, generic, etc. -->
		<div
			role="alert"
			class="flex items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			<span class="min-w-0 flex-1">{active?.error?.message}</span>
			<div class="flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
					onclick={() => {
						dismissedError = null;
						active?.reload();
					}}
				>
					<RotateCcwIcon class="size-3" />
					Retry
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					class="text-destructive hover:text-destructive"
					onclick={() => {
						dismissedError = active?.error?.message ?? null;
					}}
				>
					<XIcon class="size-3" />
				</Button>
			</div>
		</div>
	{/if}

	<!-- Chat input -->
	<ChatInput />
</div>
