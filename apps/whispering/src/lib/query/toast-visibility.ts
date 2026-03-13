import type { UnifiedNotificationOptions } from '$lib/services/notifications/types';

export type ToastVisibility = 'all' | 'important-only' | 'off';

export function shouldShowToast(
	mode: ToastVisibility,
	variant: UnifiedNotificationOptions['variant'],
): boolean {
	switch (mode) {
		case 'all':
			return true;
		case 'important-only':
			return variant === 'error' || variant === 'warning';
		case 'off':
			return false;
	}
}
