<script lang="ts">
	import * as Avatar from '@epicenter/ui/avatar';
	import { Badge } from '@epicenter/ui/badge';
	import * as DropdownMenu from '@epicenter/ui/dropdown-menu';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { createQuery } from '@tanstack/svelte-query';
	import { mode, toggleMode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth';
	import { balanceQuery } from '$lib/query/billing';
	import { capitalize, getInitials } from '$lib/utils';

	const balance = createQuery(() => balanceQuery.options);

	const subscription = $derived(
		balance.data?.subscriptions?.find((s) => !s.addOn) ?? null,
	);
	const planName = $derived(
		subscription?.plan?.name ??
			(subscription?.planId ? capitalize(subscription.planId) : 'Free'),
	);
	const isOnTrial = $derived(subscription?.trialEndsAt != null);

	const email = $derived(auth.user?.email ?? '');
	const name = $derived(auth.user?.name ?? '');

	const initials = $derived(getInitials(name, email));

	/** Open Stripe billing portal via the API. */
	async function openBillingPortal() {
		const { data, error } = await api.billing.portal();
		if (error) {
			toast.error('Could not open billing portal.');
			return;
		}
		if (data.url) window.location.href = data.url;
	}
	const isDark = $derived(mode.current === 'dark');
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
	>
		<Avatar.Root class="size-8">
			<Avatar.Fallback class="text-xs">{initials}</Avatar.Fallback>
		</Avatar.Root>
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="end" class="w-56">
		<DropdownMenu.Label class="font-normal">
			<div class="flex flex-col gap-1">
				{#if name}
					<p class="text-sm font-medium leading-none">{name}</p>
				{/if}
				<p class="text-xs text-muted-foreground leading-none">{email}</p>
				<div class="flex items-center gap-1.5 pt-1">
					<Badge variant="secondary" class="text-[10px] px-1.5 py-0">
						{planName}
					</Badge>
					{#if isOnTrial}
						<Badge
							variant="outline"
							class="text-[10px] px-1.5 py-0 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
						>
							Trial
						</Badge>
					{/if}
				</div>
			</div>
		</DropdownMenu.Label>

		<DropdownMenu.Separator />

		<DropdownMenu.Group>
			<DropdownMenu.Item onclick={openBillingPortal}>
				<CreditCardIcon class="mr-2 size-4" />
				Manage billing
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={toggleMode}>
				{#if isDark}
					<SunIcon class="mr-2 size-4" />
					Light mode
				{:else}
					<MoonIcon class="mr-2 size-4" />
					Dark mode
				{/if}
			</DropdownMenu.Item>
		</DropdownMenu.Group>

		<DropdownMenu.Separator />

		<DropdownMenu.Item onclick={() => auth.signOut()}>
			<LogOutIcon class="mr-2 size-4" />
			Sign out
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
