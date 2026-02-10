import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker root route', () => {
	it('serves app html (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne</title>');
	});

	it('serves app html (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne</title>');
	});
});
