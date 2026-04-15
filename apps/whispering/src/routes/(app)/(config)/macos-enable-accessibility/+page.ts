import { desktopServices } from '$lib/services/desktop';

export const load = async () => {
	const { data: isAccessibilityGranted } =
		await desktopServices.permissions.accessibility.check();

	return {
		isAccessibilityGranted: isAccessibilityGranted ?? false,
	};
};
