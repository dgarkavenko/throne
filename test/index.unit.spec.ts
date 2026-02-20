import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('worker root route (unit)', () => {
	it('redirects root to /game', async () => {
		const request = new Request('http://example.com');
		const fakeEnv = {
			ASSETS: { fetch: async () => new Response('unused', { status: 200 }) },
			ROOMS: {
				idFromName: () => ({}) as DurableObjectId,
				get: () => ({ fetch: async () => new Response('unused', { status: 200 }) }) as Fetcher,
			},
		} as unknown as Parameters<typeof worker.fetch>[1];
		const response = await worker.fetch(request, fakeEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('http://example.com/game');
	});
});
