import { createPersistedState } from '@epicenter/svelte';
import { AuthSession } from '@epicenter/svelte/auth';

export const session = createPersistedState({
	key: 'opensidian:authSession',
	schema: AuthSession.or('null'),
	defaultValue: null,
});
