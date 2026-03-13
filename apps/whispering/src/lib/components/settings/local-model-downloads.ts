type SharedLocalModelDownloadState = {
	isDownloading: boolean;
	progress: number;
};

type SharedLocalModelDownloadListener = (
	state: SharedLocalModelDownloadState,
) => void;

type SharedLocalModelDownloadEntry = {
	progress: number;
	promise: Promise<void>;
};

const activeDownloads = new Map<string, SharedLocalModelDownloadEntry>();
const listeners = new Map<string, Set<SharedLocalModelDownloadListener>>();

function getSnapshot(
	key: string,
): SharedLocalModelDownloadState {
	const activeDownload = activeDownloads.get(key);
	return activeDownload
		? { isDownloading: true, progress: activeDownload.progress }
		: { isDownloading: false, progress: 0 };
}

function notifyListeners(key: string) {
	const keyListeners = listeners.get(key);
	if (!keyListeners?.size) return;

	const snapshot = getSnapshot(key);
	for (const listener of keyListeners) {
		listener(snapshot);
	}
}

function updateProgress(key: string, progress: number) {
	const activeDownload = activeDownloads.get(key);
	if (!activeDownload) return;

	activeDownload.progress = progress;
	notifyListeners(key);
}

export function getSharedLocalModelDownloadState(
	key: string,
): SharedLocalModelDownloadState {
	return getSnapshot(key);
}

export function subscribeSharedLocalModelDownload(
	key: string,
	listener: SharedLocalModelDownloadListener,
) {
	const keyListeners = listeners.get(key) ?? new Set<SharedLocalModelDownloadListener>();
	keyListeners.add(listener);
	listeners.set(key, keyListeners);
	listener(getSnapshot(key));

	return () => {
		const currentListeners = listeners.get(key);
		if (!currentListeners) return;

		currentListeners.delete(listener);
		if (!currentListeners.size) {
			listeners.delete(key);
		}
	};
}

export function startSharedLocalModelDownload(
	key: string,
	download: (updateProgress: (progress: number) => void) => Promise<void>,
) {
	const existingDownload = activeDownloads.get(key);
	if (existingDownload) {
		return existingDownload.promise;
	}

	const { promise, resolve, reject } = Promise.withResolvers<void>();
	activeDownloads.set(key, {
		progress: 0,
		promise,
	});
	notifyListeners(key);

	void (async () => {
		try {
			await download((progress) => updateProgress(key, progress));
			resolve();
		} catch (error) {
			reject(error);
		} finally {
			activeDownloads.delete(key);
			notifyListeners(key);
		}
	})();

	return promise;
}
