import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('worker routes (integration)', () => {
	it('serves editor html', async () => {
		const response = await SELF.fetch('https://example.com/editor');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne</title>');
	});

	it('serves game html', async () => {
		const response = await SELF.fetch('https://example.com/game');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Throne Game</title>');
	});
});
