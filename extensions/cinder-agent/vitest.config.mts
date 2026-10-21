import { defineConfig } from 'vitest/config';

// `npm test` runs the fast unit tests. `npm run test:smoke` also starts a
// real Claude Code process through the Agent SDK (needs network access).
export default defineConfig({
	test: {
		include: process.env.CINDER_SMOKE ? ['test/**/*.smoke.test.ts'] : ['test/**/*.test.ts'],
		exclude: process.env.CINDER_SMOKE ? [] : ['test/**/*.smoke.test.ts'],
		testTimeout: 120_000,
	},
});
