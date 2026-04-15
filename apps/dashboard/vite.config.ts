import { APPS } from '@epicenter/constants/apps';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	server: {
		port: APPS.DASHBOARD.port,
		strictPort: true,
		proxy: {
			// Forward API requests to the local Hono dev server
			'/api': {
				target: `http://localhost:${APPS.API.port}`,
				changeOrigin: true,
			},
			// Forward auth requests for session cookies
			'/auth': {
				target: `http://localhost:${APPS.API.port}`,
				changeOrigin: true,
			},
		},
	},
});
