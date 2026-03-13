export function createVadStreamLifecycle({
	initialStream,
	cleanupStream,
	setCurrentStream,
	reacquireStream,
}: {
	initialStream: MediaStream;
	cleanupStream: (stream: MediaStream) => void;
	setCurrentStream: (stream: MediaStream | null) => void;
	reacquireStream: () => Promise<MediaStream>;
}) {
	return {
		getStream: async () => {
			setCurrentStream(initialStream);
			return initialStream;
		},
		pauseStream: async (stream: MediaStream) => {
			cleanupStream(stream);
			setCurrentStream(null);
		},
		resumeStream: async () => {
			const stream = await reacquireStream();
			setCurrentStream(stream);
			return stream;
		},
	};
}
