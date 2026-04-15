import { createQuery } from '@tanstack/svelte-query';
import { rpc } from '$lib/query';
import { desktopRpc } from '$lib/query/desktop';

export function syncIconWithRecorderState() {
	const getRecorderStateQuery = createQuery(
		() => rpc.recorder.getRecorderState.options,
	);

	$effect(() => {
		if (getRecorderStateQuery.data) {
			desktopRpc.tray.setTrayIcon({
				icon: getRecorderStateQuery.data,
			});
		}
	});
}
