import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					include: ['test/**/*.spec.ts'],
					exclude: ['test/index.worker.spec.ts', 'test/room-replication.spec.ts'],
				},
			},
			defineWorkersProject({
				test: {
					name: 'workers',
					include: ['test/index.worker.spec.ts', 'test/room-replication.spec.ts'],
					poolOptions: {
						workers: {
							wrangler: { configPath: './wrangler.jsonc' },
						},
					},
				},
			}),
		],
	},
});
