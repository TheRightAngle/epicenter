import { APPS } from '@epicenter/constants/apps';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
	plugins: [
		sveltekit(),
		tailwindcss(),
		// just-bash's browser bundle statically imports node:zlib for gzip/gunzip
		// commands. This is a known upstream issue (vercel-labs/just-bash#81).
		// The polyfill provides a browser-compatible zlib implementation.
		nodePolyfills({ include: ['zlib'] }),
	],
	resolve: {
		dedupe: ['yjs'],
	},
	optimizeDeps: {
		// @libsql/client-wasm bundles a WASM SQLite build via
		// @libsql/libsql-wasm-experimental. Vite's dep optimizer
		// can't handle WASM imports from these packages, so we
		// exclude them from pre-bundling and let them load natively.
		exclude: ['@libsql/libsql-wasm-experimental'],
	},
	server: {
		port: APPS.OPENSIDIAN.port,
		strictPort: true,
		headers: {
			// Required for SharedArrayBuffer (used by @libsql WASM worker)
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
});
