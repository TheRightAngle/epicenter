/**
 * TanStack Query definitions for billing data.
 *
 * Static queries use `defineQuery` for the dual interface (.options + .fetch()).
 * Parameterized queries return plain option objects since callers only need .options.
 * Mutations use `defineMutation` for the dual interface (.options + .execute()).
 */
import type {
	EventsParams,
	UsageParams,
} from '@epicenter/api/billing-contract';
import { api } from '$lib/api';
import { defineMutation, defineQuery } from '$lib/query/client';

/**
 * Centralized query key objects for billing queries.
 *
 * Using a key object instead of inline string arrays prevents typo-based
 * invalidation bugs and makes refactoring safe—rename a key and TypeScript
 * catches every stale reference.
 *
 * @example
 * ```typescript
 * queryClient.invalidateQueries({ queryKey: billingKeys.all });
 * queryClient.invalidateQueries({ queryKey: billingKeys.balance });
 * ```
 */
export const billingKeys = {
	all: ['billing'] as const,
	balance: ['billing', 'balance'] as const,
	usage: (params: UsageParams) => ['billing', 'usage', params] as const,
	events: (params: EventsParams) => ['billing', 'events', params] as const,
	plans: ['billing', 'plans'] as const,
	models: ['billing', 'models'] as const,
};

/** Fetch customer balance, subscription, and credit breakdown. */
export const balanceQuery = defineQuery({
	queryKey: billingKeys.balance,
	queryFn: () => api.billing.balance(),
});

/**
 * Fetch aggregated usage data for charts.
 *
 * Returns plain query options—callers pass these to `createQuery()`.
 * Uses a factory function because the query key depends on `params`.
 */
export function usageQueryOptions(params: UsageParams = {}) {
	return {
		queryKey: billingKeys.usage(params),
		queryFn: () => api.billing.usage(params),
	};
}

/**
 * Fetch paginated event history for the activity feed.
 *
 * Returns plain query options—callers pass these to `createQuery()`.
 */
export function eventsQueryOptions(params: EventsParams = {}) {
	return {
		queryKey: billingKeys.events(params),
		queryFn: () => api.billing.events(params),
	};
}

/** Fetch available plans with customer eligibility. */
export const plansQuery = defineQuery({
	queryKey: billingKeys.plans,
	queryFn: () => api.billing.plans(),
});

/** Fetch model credits map and plan metadata. */
export const modelsQuery = defineQuery({
	queryKey: billingKeys.models,
	queryFn: () => api.billing.models(),
});

/** Buy 500 credits via Stripe checkout. */
export const topUpMutation = defineMutation({
	mutationKey: [...billingKeys.all, 'top-up'] as const,
	mutationFn: (successUrl?: string) => api.billing.topUp(successUrl),
});

/** Preview proration cost before changing plans. */
export const previewUpgradeMutation = defineMutation({
	mutationKey: [...billingKeys.all, 'preview'] as const,
	mutationFn: (planId: string) => api.billing.preview(planId),
});

/** Upgrade or switch billing plan via Stripe. */
export const upgradePlanMutation = defineMutation({
	mutationKey: [...billingKeys.all, 'upgrade'] as const,
	mutationFn: ({
		planId,
		successUrl,
	}: {
		planId: string;
		successUrl?: string;
	}) => api.billing.upgrade(planId, successUrl),
});
