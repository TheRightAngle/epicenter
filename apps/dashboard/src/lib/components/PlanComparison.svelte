<script lang="ts">
	import { ANNUAL_PLANS, PLAN_IDS, PLANS } from '@epicenter/api/billing-plans';
	import { Badge } from '@epicenter/ui/badge';
	import { Button } from '@epicenter/ui/button';
	import * as Card from '@epicenter/ui/card';
	import * as Dialog from '@epicenter/ui/dialog';
	import { Skeleton } from '@epicenter/ui/skeleton';
	import { Spinner } from '@epicenter/ui/spinner';
	import { createMutation, createQuery } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import {
		balanceQuery,
		billingKeys,
		plansQuery,
		previewUpgradeMutation,
		upgradePlanMutation,
	} from '$lib/query/billing';
	import { queryClient } from '$lib/query/client';

	/** Visible plan IDs in display order. Free is NOT shown as a card. */
	const VISIBLE_PLAN_IDS = {
		monthly: ['pro', 'ultra', 'max'] as const,
		annual: ['pro_annual', 'ultra_annual', 'max_annual'] as const,
	};

	function formatPrice(amount: number, interval: 'month' | 'year'): string {
		return `$${amount.toLocaleString()}/${interval === 'month' ? 'mo' : 'yr'}`;
	}

	function formatOverage(overage: {
		amount: number;
		billingUnits: number;
	}): string {
		const amt = Number.isInteger(overage.amount)
			? `${overage.amount}`
			: overage.amount.toFixed(2);
		return `$${amt}/${overage.billingUnits}`;
	}

	/** Display metadata derived from plan constants in @epicenter/api/billing-plans. */
	const PLAN_DISPLAY = Object.fromEntries([
		...VISIBLE_PLAN_IDS.monthly.map((id) => {
			const plan = PLANS[id];
			const annual = Object.values(ANNUAL_PLANS).find(
				(p) => p.monthlyEquivalent === id,
			);
			return [
				id,
				{
					name: plan.name,
					price: formatPrice(plan.price.amount, plan.price.interval),
					annualPrice: annual
						? `$${Math.round(annual.price.amount / 12)}/mo`
						: formatPrice(plan.price.amount, plan.price.interval),
					credits: plan.credits.included.toLocaleString(),
					overage: formatOverage(plan.credits.overage),
					rollover: id === PLAN_IDS.ultra || id === PLAN_IDS.max,
					isRecommended: id === PLAN_IDS.ultra,
				},
			];
		}),
		...VISIBLE_PLAN_IDS.annual.map((id) => {
			const plan = ANNUAL_PLANS[id];
			return [
				id,
				{
					name: plan.name.replace(' (Annual)', ''),
					price: formatPrice(plan.price.amount, plan.price.interval),
					annualPrice: formatPrice(plan.price.amount, plan.price.interval),
					credits: plan.credits.included.toLocaleString(),
					overage: formatOverage(plan.credits.overage),
					rollover:
						plan.monthlyEquivalent === PLAN_IDS.ultra ||
						plan.monthlyEquivalent === PLAN_IDS.max,
					isRecommended: plan.monthlyEquivalent === PLAN_IDS.ultra,
				},
			];
		}),
	]);

	let isAnnual = $state(false);
	let confirmDialog = $state<{ planId: string; planName: string } | null>(null);
	let previewData = $state<{
		prorationAmount?: number;
		currency?: string;
	} | null>(null);

	const balance = createQuery(() => balanceQuery.options);
	const plans = createQuery(() => plansQuery.options);

	const currentPlanId = $derived(
		balance.data?.subscriptions?.find((s) => !s.addOn)?.planId ?? 'free',
	);

	const subscription = $derived(
		balance.data?.subscriptions?.find((s) => !s.addOn) ?? null,
	);
	const trialEndsAt = $derived(subscription?.trialEndsAt ?? null);
	const trialEndDate = $derived(
		trialEndsAt
			? new Date(trialEndsAt).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
				})
			: null,
	);

	const visiblePlanIds = $derived(
		isAnnual ? VISIBLE_PLAN_IDS.annual : VISIBLE_PLAN_IDS.monthly,
	);

	const eligibilityMap = $derived(
		new Map(
			(plans.data?.list ?? []).map((p) => [
				p.id,
				p.customerEligibility?.attachAction,
			]),
		),
	);

	const previewMutation = createMutation(() => previewUpgradeMutation.options);

	const upgradeMutation = createMutation(() => upgradePlanMutation.options);

	async function handleUpgradeClick(planId: string, planName: string) {
		confirmDialog = { planId, planName };
		previewData = null;
		previewMutation.mutate(planId, {
			onSuccess: (data) => {
				previewData = data;
			},
		});
	}
</script>
<section class="mt-10 mb-8">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-lg font-semibold">Plans</h2>
		<div class="flex items-center gap-2 rounded-lg bg-muted p-1 text-xs">
			<Button
				variant="ghost"
				size="sm"
				class="rounded-md {!isAnnual ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
				onclick={() => (isAnnual = false)}
				>Monthly</Button
			>
			<Button
				variant="ghost"
				size="sm"
				class="rounded-md {isAnnual ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
				onclick={() => (isAnnual = true)}
				>Annual <span class="ml-1 text-emerald-500">Save ~17%</span></Button
			>
		</div>
	</div>

	{#if plans.isPending}
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			{#each Array(3) as _}
				<Skeleton class="h-64" />
			{/each}
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			{#each visiblePlanIds as planId}
				{@const display = PLAN_DISPLAY[planId]}
				{@const isCurrent = currentPlanId === planId || (isAnnual && currentPlanId === planId.replace('_annual', ''))}
				{@const eligibility = eligibilityMap.get(planId)}
				{@const isRecommended = 'isRecommended' in display && display.isRecommended}

				<Card.Root
					class="{isRecommended ? 'border-primary ring-1 ring-primary' : ''} {isCurrent ? 'border-emerald-700 bg-emerald-950/20' : ''} flex flex-col"
				>
					<Card.Header class="pb-2">
						<div class="flex items-center gap-2">
							<Card.Title>{display.name}</Card.Title>
							{#if isRecommended}
								<Badge variant="default" class="text-xs">Recommended</Badge>
							{/if}
						</div>
						<p class="text-2xl font-bold">
							{isAnnual ? display.annualPrice : display.price}
						</p>
					</Card.Header>
					<Card.Content class="flex-1 space-y-2 text-sm text-muted-foreground">
						<p>{display.credits} credits/mo</p>
						<p>{display.overage} overage</p>
						<p>All AI models</p>
						{#if display.rollover}
							<p class="text-emerald-400">∞ credit rollover</p>
						{:else}
							<p>Credits reset monthly</p>
						{/if}
					</Card.Content>
					<Card.Footer>
						{#if isCurrent}
							<Button variant="outline" class="w-full" disabled>
								Current plan
								{#if trialEndsAt}
									&nbsp;(trial)
								{/if}
							</Button>
						{:else}
							<Button
								class="w-full"
								variant={eligibility === 'upgrade' ? 'default' : 'secondary'}
								onclick={() => handleUpgradeClick(planId, display.name)}
							>
								{eligibility === 'upgrade'
									? `Upgrade to ${display.name}`
									: eligibility === 'downgrade'
										? `Downgrade to ${display.name}`
										: `Switch to ${display.name}`}
							</Button>
						{/if}
					</Card.Footer>
				</Card.Root>
			{/each}
		</div>

		<p class="mt-4 text-xs text-muted-foreground text-center">
			{#if trialEndDate}
				Currently on {PLAN_DISPLAY[currentPlanId]?.name ?? currentPlanId} trial
				— ends {trialEndDate}.
			{:else}
				Currently on
				{currentPlanId === 'free' ? 'Free (50 credits/mo)' : currentPlanId}.
			{/if}
			All plans include cloud sync, unlimited workspaces, unlimited history, and
			encryption.
		</p>
	{/if}
</section>

<!-- Upgrade confirmation dialog -->
<Dialog.Root
	open={!!confirmDialog}
	onOpenChange={(open) => { if (!open) confirmDialog = null; }}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Upgrade to {confirmDialog?.planName}</Dialog.Title>
			<Dialog.Description>
				{#if previewMutation.isPending}
					Calculating cost...
				{:else if previewData?.prorationAmount !== undefined}
					You'll be charged ${(previewData.prorationAmount / 100).toFixed(2)}
					today (prorated).
				{:else}
					Confirm your plan change.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmDialog = null)}>
				Cancel
			</Button>
			<Button
				onclick={() => {
					if (confirmDialog) {
						upgradeMutation.mutate(
							{ planId: confirmDialog.planId, successUrl: window.location.href },
							{
								onSuccess: (data) => {
									if (data.paymentUrl) {
										window.location.href = data.paymentUrl;
									} else {
										toast.success('Plan updated successfully');
										confirmDialog = null;
										queryClient.invalidateQueries({ queryKey: billingKeys.all });
									}
								},
								onError: () => toast.error('Upgrade failed. Please try again.'),
							},
						);
					}
				}}
				disabled={upgradeMutation.isPending}
			>
				{#if upgradeMutation.isPending}
					<Spinner class="size-3.5" />
				{:else}
					Confirm upgrade
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
