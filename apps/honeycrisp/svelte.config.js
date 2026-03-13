import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticAdapter({
			fallback: 'index.html',
		}),
		alias: {
			$routes: './src/routes',
			'#': '../../packages/ui/src',
		},
	},
	preprocess: vitePreprocess(),
};

export default config;
