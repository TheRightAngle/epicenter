import type { BetterAuthOptions } from 'better-auth';

/** Shared Better Auth config used by both the runtime and the CLI schema tool. */
export const BASE_AUTH_CONFIG = {
	basePath: '/auth',
	emailAndPassword: { enabled: true },
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ['google', 'email-password'],
		},
	},
} satisfies BetterAuthOptions;
