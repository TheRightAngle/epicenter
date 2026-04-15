import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { LOCAL_DATABASE_URL } from './env';

config({ path: fileURLToPath(new URL('.dev.vars', import.meta.url)) });

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
	},
});
