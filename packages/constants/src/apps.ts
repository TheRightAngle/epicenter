/**
 * Single source of truth for all Epicenter app URLs and ports.
 *
 * Each app declares its dev port and production URLs. The first URL in
 * `urls` is the canonical production URL (used by Vite prod builds).
 * All URLs are included in CORS and trusted origins.
 *
 * To add an app: add an entry here. TypeScript enforces that every
 * consumer picks it up automatically.
 */

export const APPS = {
	API: { port: 8787, urls: ['https://api.epicenter.so'] },
	SH: { port: 5173, urls: ['https://epicenter.sh'] },
	AUDIO: { port: 1420, urls: ['https://whispering.epicenter.so'] },
	FUJI: { port: 5174, urls: ['https://fuji.epicenter.so'] },
	HONEYCRISP: { port: 5175, urls: ['https://honeycrisp.epicenter.so'] },
	OPENSIDIAN: {
		port: 5176,
		urls: ['https://opensidian.com', 'https://opensidian.epicenter.so'],
	},
	ZHONGWEN: { port: 8888, urls: ['https://zhongwen.epicenter.so'] },
	DASHBOARD: { port: 5178, urls: ['https://api.epicenter.so'] },
} as const;

export type AppId = keyof typeof APPS;
