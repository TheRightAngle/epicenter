/**
 * Public auth contracts that other packages can safely import from `@epicenter/api`.
 *
 * These exports are intentionally limited to portable response and field types.
 * Client-only Better Auth inference helpers belong in the consuming package,
 * and server runtime wiring belongs next to the auth factory.
 */
export type { SessionResponse } from './get-session';
