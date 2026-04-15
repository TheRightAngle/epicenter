<script lang="ts">
	import * as Alert from '@epicenter/ui/alert';
	import { Button } from '@epicenter/ui/button';
	import { Spinner } from '@epicenter/ui/spinner';
	import * as Tabs from '@epicenter/ui/tabs';
	import { createMutation, createQuery } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import ActivityFeed from '$lib/components/ActivityFeed.svelte';
	import CreditBalance from '$lib/components/CreditBalance.svelte';
	import ModelCostGuide from '$lib/components/ModelCostGuide.svelte';
	import PlanComparison from '$lib/components/PlanComparison.svelte';
	import TopModels from '$lib/components/TopModels.svelte';
	import UsageChart from '$lib/components/UsageChart.svelte';
	import { balanceQuery, billingKeys, topUpMutation } from '$lib/query/billing';
	import { queryClient } from '$lib/query/client';

	const balance = createQuery(() => balanceQuery.options);
	const subscription = $derived(
		balance.data?.subscriptions?.find((s) => !s.addOn) ?? null,
	);
	const isOnTrial = $derived(subscription?.trialEndsAt != null);

	/** Open Stripe billing portal via the API. */
	async function openBillingPortal() {
		const { data, error } = await api.billing.portal();
		if (error) {
			toast.error('Could not open billing portal.');
			return;
		}
		if (data.url) window.location.href = data.url;
	}

	const topUp = createMutation(() => topUpMutation.options);
</script>

<CreditBalance />

{#if isOnTrial}
	<Alert.Root class="mb-6">
		<Alert.Description class="flex items-center justify-between">
			<span>Add a payment method to keep Ultra after your trial ends.</span>
			<Button variant="link" size="sm" onclick={openBillingPortal}
				>Update billing →</Button
			>
		</Alert.Description>
	</Alert.Root>
{/if}

<Tabs.Root value="overview">
	<Tabs.List>
		<Tabs.Trigger value="overview">Overview</Tabs.Trigger>
		<Tabs.Trigger value="models">Models</Tabs.Trigger>
		<Tabs.Trigger value="activity">Activity</Tabs.Trigger>
	</Tabs.List>

	<Tabs.Content value="overview" class="pt-6">
		<UsageChart />
		<TopModels />
	</Tabs.Content>

	<Tabs.Content value="models" class="pt-6"> <ModelCostGuide /> </Tabs.Content>

	<Tabs.Content value="activity" class="pt-6"> <ActivityFeed /> </Tabs.Content>
</Tabs.Root>

<PlanComparison />

<section class="flex flex-wrap gap-3">
	<Button
		variant="outline"
		onclick={() => {
			topUp.mutate(window.location.href, {
				onSuccess: (data) => {
					if (data.paymentUrl) {
						window.location.href = data.paymentUrl;
					} else {
						toast.success('Credits added to your account');
						queryClient.invalidateQueries({ queryKey: billingKeys.all });
					}
				},
				onError: () => toast.error('Top-up failed. Please try again.'),
			});
		}}
		disabled={topUp.isPending}
	>
		{#if topUp.isPending}
			<Spinner class="size-3.5" />
		{:else}
			Buy 500 credits — $5
		{/if}
	</Button>
	<Button variant="outline" onclick={openBillingPortal}>Manage billing</Button>
</section>
