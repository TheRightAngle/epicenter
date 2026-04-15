<script lang="ts">
	import { FEATURE_IDS } from '@epicenter/api/billing-plans';
	import { Badge } from '@epicenter/ui/badge';
	import * as Card from '@epicenter/ui/card';
	import { Progress } from '@epicenter/ui/progress';
	import { Skeleton } from '@epicenter/ui/skeleton';
	import { createQuery } from '@tanstack/svelte-query';
	import { balanceQuery } from '$lib/query/billing';
	import { capitalize } from '$lib/utils';

	const balance = createQuery(() => balanceQuery.options);

	/** The ai_credits balance object from the customer response. */
	const creditBalance = $derived(
		balance.data?.balances?.[FEATURE_IDS.aiCredits] ?? null,
	);
	const currentBalance = $derived(creditBalance?.remaining ?? 0);
	const totalGranted = $derived(creditBalance?.granted ?? 0);
	const usagePercent = $derived(
		totalGranted > 0
			? Math.min(100, Math.round((currentBalance / totalGranted) * 100))
			: 0,
	);

	/** Find the monthly breakdown entry for the reset countdown. */
	const monthlyEntry = $derived(
		creditBalance?.breakdown?.find((e) => e.reset?.interval === 'month') ??
			null,
	);
	const rolloverEntry = $derived(creditBalance?.rollovers?.[0] ?? null);

	/** resetsAt is epoch ms from the Balance level, not breakdown. */
	const resetTimestamp = $derived(creditBalance?.nextResetAt ?? null);
	const daysUntilReset = $derived(
		resetTimestamp !== null
			? Math.max(0, Math.ceil((resetTimestamp - Date.now()) / 86_400_000))
			: null,
	);

	/** Find the active non-addOn subscription to check for trial status. */
	const subscription = $derived(
		balance.data?.subscriptions?.find((s) => !s.addOn) ?? null,
	);
	const trialEndsAt = $derived(subscription?.trialEndsAt ?? null);
	const trialDaysLeft = $derived(
		trialEndsAt !== null
			? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86_400_000))
			: null,
	);
	const trialPlanName = $derived(
		subscription?.plan?.name ??
			(subscription?.planId ? capitalize(subscription.planId) : 'Free'),
	);
	const trialIsUrgent = $derived(trialDaysLeft !== null && trialDaysLeft <= 3);
</script>

{#if balance.isPending}
	<Card.Root class="mb-8">
		<Card.Header> <Skeleton class="h-6 w-20" /> </Card.Header>
		<Card.Content>
			<Skeleton class="h-8 w-32 mb-3" />
			<Skeleton class="h-2 w-full" />
		</Card.Content>
	</Card.Root>
{:else if balance.isError}
	<Card.Root class="mb-8 border-destructive">
		<Card.Content class="pt-6">
			<p class="text-sm text-destructive">
				Failed to load balance. Try refreshing.
			</p>
		</Card.Content>
	</Card.Root>
{:else}
	<Card.Root class="mb-8">
		<Card.Header class="flex-row items-center justify-between space-y-0 pb-2">
			<Card.Title class="text-sm font-medium">Credits</Card.Title>
			{#if daysUntilReset !== null}
				<Badge variant="secondary" class="text-xs">
					Resets in {daysUntilReset} day{daysUntilReset === 1 ? '' : 's'}
				</Badge>
			{/if}
			{#if trialDaysLeft !== null}
				<Badge
					variant={trialIsUrgent ? 'destructive' : 'outline'}
					class={trialIsUrgent
						? ''
						: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'}
				>
					{trialPlanName}
					Trial — {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}
					left
				</Badge>
			{/if}
		</Card.Header>
		<Card.Content>
			<div class="flex items-baseline gap-2 mb-3">
				<span class="text-3xl font-bold tabular-nums">
					{currentBalance.toLocaleString()}
				</span>
				<span class="text-sm text-muted-foreground">
					of {totalGranted.toLocaleString()} included
				</span>
			</div>

			<Progress value={usagePercent} class="h-2 mb-3" />

			{#if rolloverEntry && rolloverEntry.balance > 0}
				<div class="flex gap-4 text-xs text-muted-foreground">
					<span>
						Monthly: {(monthlyEntry?.remaining ?? 0).toLocaleString()}
					</span>
					<span>Rollover: {rolloverEntry.balance.toLocaleString()}</span>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
