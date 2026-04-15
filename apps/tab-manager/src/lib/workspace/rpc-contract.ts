/**
 * Tab Manager RPC Contract — type-only export for cross-device calls.
 *
 * Import this type in other apps (CLI, desktop, etc.) to get type-safe
 * RPC calls against the tab-manager's actions. Zero runtime cost.
 *
 * @example
 * ```typescript
 * import type { TabManagerRpc } from '@epicenter/tab-manager/rpc';
 *
 * const { data, error } = await workspace.extensions.sync.rpc<TabManagerRpc>(
 *   peer.clientId, 'tabs.close', { tabIds: [1, 2, 3] },
 * );
 * // data is { closedCount: number } | null — fully inferred
 * ```
 */
import type { InferRpcMap } from '@epicenter/workspace';
import type { workspace } from '../client';

export type TabManagerRpc = InferRpcMap<(typeof workspace)['actions']>;
