/**
 * Single source of truth for billing IDs and plan metadata.
 * Runtime-safe (no atmn dependency). Both autumn.config.ts (CLI)
 * and runtime code (billing-routes.ts, ai-chat.ts) import from here.
 */

export const FEATURE_IDS = {
	aiUsage: 'ai_usage',
	aiCredits: 'ai_credits',
	storageBytes: 'storage_bytes',
} as const;

export const PLAN_IDS = {
	free: 'free',
	pro: 'pro',
	ultra: 'ultra',
	max: 'max',
	creditTopUp: 'credit_top_up',
	proAnnual: 'pro_annual',
	ultraAnnual: 'ultra_annual',
	maxAnnual: 'max_annual',
} as const;

/** Main plan IDs in display order (monthly). */
export const MAIN_PLAN_IDS = [
	PLAN_IDS.free,
	PLAN_IDS.pro,
	PLAN_IDS.ultra,
	PLAN_IDS.max,
] as const;

/** Annual plan IDs in display order. */
export const ANNUAL_PLAN_IDS = [
	PLAN_IDS.proAnnual,
	PLAN_IDS.ultraAnnual,
	PLAN_IDS.maxAnnual,
] as const;

export const PLANS = {
	[PLAN_IDS.free]: {
		name: 'Free',
		group: 'main',
		addOn: false,
		autoEnable: true,
		price: null,
		credits: { included: 50, reset: 'month' as const, overage: null },
	},
	[PLAN_IDS.pro]: {
		name: 'Pro',
		group: 'main',
		addOn: false,
		autoEnable: false,
		price: { amount: 20, interval: 'month' as const },
		credits: {
			included: 2500,
			reset: 'month' as const,
			overage: {
				amount: 1,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
	[PLAN_IDS.ultra]: {
		name: 'Ultra',
		group: 'main',
		addOn: false,
		autoEnable: false,
		price: { amount: 60, interval: 'month' as const },
		credits: {
			included: 10000,
			reset: 'month' as const,
			overage: {
				amount: 0.75,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
	[PLAN_IDS.max]: {
		name: 'Max',
		group: 'main',
		addOn: false,
		autoEnable: false,
		price: { amount: 200, interval: 'month' as const },
		credits: {
			included: 50000,
			reset: 'month' as const,
			overage: {
				amount: 0.5,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
	[PLAN_IDS.creditTopUp]: {
		name: 'Credit Top-Up',
		group: '',
		addOn: true,
		autoEnable: false,
		price: null,
		credits: {
			included: 0,
			reset: null,
			overage: {
				amount: 5,
				billingUnits: 500,
				billingMethod: 'prepaid' as const,
			},
		},
	},
} as const;

/**
 * Annual plan metadata. Credits reset monthly (same as monthly plans),
 * but billing is yearly at ~17% discount (2 months free).
 */
export const ANNUAL_PLANS = {
	[PLAN_IDS.proAnnual]: {
		name: 'Pro (Annual)',
		group: 'main',
		addOn: false,
		autoEnable: false,
		monthlyEquivalent: PLAN_IDS.pro,
		price: { amount: 200, interval: 'year' as const },
		credits: {
			included: 2500,
			reset: 'month' as const,
			overage: {
				amount: 1,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
	[PLAN_IDS.ultraAnnual]: {
		name: 'Ultra (Annual)',
		group: 'main',
		addOn: false,
		autoEnable: false,
		monthlyEquivalent: PLAN_IDS.ultra,
		price: { amount: 600, interval: 'year' as const },
		credits: {
			included: 10000,
			reset: 'month' as const,
			overage: {
				amount: 0.75,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
	[PLAN_IDS.maxAnnual]: {
		name: 'Max (Annual)',
		group: 'main',
		addOn: false,
		autoEnable: false,
		monthlyEquivalent: PLAN_IDS.max,
		price: { amount: 2000, interval: 'year' as const },
		credits: {
			included: 50000,
			reset: 'month' as const,
			overage: {
				amount: 0.5,
				billingUnits: 100,
				billingMethod: 'usage_based' as const,
			},
		},
	},
} as const;
