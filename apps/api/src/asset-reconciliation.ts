/**
 * Storage billing reconciliation.
 *
 * Autumn `track()` can fail silently (network issues, Worker timeout). This
 * function corrects drift by setting absolute storage totals from Postgres
 * via the Autumn REST API's `/usage` endpoint.
 *
 * Can be invoked via:
 * - Manual admin endpoint: POST /api/assets/reconcile
 * - Cloudflare Cron Trigger (add to wrangler.jsonc when ready)
 */

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FEATURE_IDS } from './billing-plans.js';
import * as schema from './db/schema.js';

type ReconcileResult = {
	usersProcessed: number;
	errors: number;
};

/**
 * Set absolute usage for a customer via the Autumn REST API.
 *
 * The SDK doesn't expose `usage()` (absolute set), only `track()` (delta).
 * For reconciliation we need to set the absolute total, so we call the
 * REST endpoint directly.
 */
async function setAbsoluteUsage(
	secretKey: string,
	customerId: string,
	featureId: string,
	value: number,
): Promise<void> {
	const res = await fetch('https://api.useautumn.com/v1/usage', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${secretKey}`,
		},
		body: JSON.stringify({
			customer_id: customerId,
			feature_id: featureId,
			value,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Autumn /usage failed (${res.status}): ${body}`);
	}
}

/**
 * Reconcile Autumn storage billing with Postgres totals.
 *
 * Iterates all users with assets and sets their absolute storage total
 * in Autumn. This corrects any drift from failed `track()` calls.
 *
 * @example
 * ```typescript
 * const result = await reconcileStorageBilling(db, 'am_sk_test_...');
 * console.log(`Processed ${result.usersProcessed} users, ${result.errors} errors`);
 * ```
 */
export async function reconcileStorageBilling(
	db: NodePgDatabase<typeof schema>,
	secretKey: string,
): Promise<ReconcileResult> {
	// Get per-user storage totals in one query
	const userTotals = await db
		.select({
			userId: schema.asset.userId,
			totalBytes: sql<number>`COALESCE(SUM(${schema.asset.sizeBytes}), 0)`,
		})
		.from(schema.asset)
		.groupBy(schema.asset.userId);

	let errors = 0;

	// Set absolute usage for each user
	for (const { userId, totalBytes } of userTotals) {
		try {
			await setAbsoluteUsage(
				secretKey,
				userId,
				FEATURE_IDS.storageBytes,
				totalBytes,
			);
		} catch (e) {
			console.error(`[reconciliation] Failed for user ${userId}:`, e);
			errors++;
		}
	}

	return { usersProcessed: userTotals.length, errors };
}
