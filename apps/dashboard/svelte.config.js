import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticAdapter({
			pages: 'build/dashboard',
			assets: 'build/dashboard',
			fallback: 'index.html',
		}),
		paths: {
			base: '/dashboard',
		},
		alias: {
			'#': '../../packages/ui/src',
		},
	},
	preprocess: vitePreprocess(),
};

export default config;
