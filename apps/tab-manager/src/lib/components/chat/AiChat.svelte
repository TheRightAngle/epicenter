<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import { aiChatState } from '$lib/chat/chat-state.svelte';
	import ChatErrorBanner from './ChatErrorBanner.svelte';
	import ChatInput from './ChatInput.svelte';
	import ConversationPicker from './ConversationPicker.svelte';
	import MessageList from './MessageList.svelte';

	const active = $derived(aiChatState.active);
</script>

<div class="flex h-full flex-col">
	<ConversationPicker
		conversations={aiChatState.conversations}
		activeId={aiChatState.activeConversationId}
		onSwitch={(id) => aiChatState.switchTo(id)}
		onCreate={() => aiChatState.createConversation()}
	/>

	<div class="min-h-0 flex-1">
		<MessageList
			messages={active?.messages ?? []}
			status={active?.status ?? 'ready'}
			onReload={() => active?.reload()}
			onApproveToolCall={(id) => active?.approveToolCall(id)}
			onDenyToolCall={(id) => active?.denyToolCall(id)}
		/>
	</div>

	<!-- Error states: auth + credits are persistent, others go to ChatErrorBanner -->
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
	{:else if active}
		<ChatErrorBanner
			error={active.error}
			dismissedError={active.dismissedError}
			onRetry={() => {
				active.dismissedError = null;
				active.reload();
			}}
			onDismiss={() => {
				active.dismissedError = active.error?.message ?? null;
			}}
		/>
	{/if}

	<ChatInput {active} />
</div>
