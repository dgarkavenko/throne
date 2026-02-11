import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker root route', () => {
	it('redirects root to /game (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('http://example.com/game');
	});

	it('serves editor html (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/editor');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne</title>');
	});

	it('serves game html (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/game');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne Game</title>');
	});
});
