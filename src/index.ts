/**
 * Worker HTTP router.
 * Route branches:
 * - `/` redirect to `/game`
 * - `/game` and `/editor` HTML shells
 * - `/room/:id` WebSocket forwarding to Room Durable Object
 * - static JS/module asset proxy for compiled client artifacts
 */
import { editorHtml, gameHtml } from './html';
import { RoomDurableObject } from './server-game';

export { RoomDurableObject };

export default {
	async fetch(request, env): Promise<Response>
	{
		const url = new URL(request.url);

		if (url.pathname === '/')
		{
			const redirectUrl = new URL(request.url);
			redirectUrl.pathname = '/game';
			return Response.redirect(redirectUrl.toString(), 302);
		}

		if (url.pathname === '/editor')
		{
			return new Response(editorHtml, {
				headers: {
					'content-type': 'text/html; charset=utf-8',
				},
			});
		}

		if (url.pathname === '/game')
		{
			return new Response(gameHtml, {
				headers: {
					'content-type': 'text/html; charset=utf-8',
				},
			});
		}

		const isClientAsset =
			url.pathname === '/client-editor.js' ||
			url.pathname === '/client-game.js' ||
			url.pathname.startsWith('/client/');

		const isTerrainAsset = url.pathname.startsWith('/terrain/');
		const isEcsAsset = url.pathname.startsWith('/ecs/');

		if (isClientAsset || isTerrainAsset || isEcsAsset)
		{
			if (
				url.pathname.startsWith('/client/') ||
				url.pathname.startsWith('/terrain/') ||
				url.pathname.startsWith('/ecs/')
			)
			{
				const lastSegment = url.pathname.split('/').at(-1) ?? '';
				if (lastSegment && !lastSegment.includes('.'))
				{
					const assetUrl = new URL(request.url);
					assetUrl.pathname = `${url.pathname}.js`;
					return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
				}
			}

			return env.ASSETS.fetch(request);
		}

		if (url.pathname.startsWith('/room/'))
		{
			const roomId = url.pathname.replace('/room/', '').trim();
			if (!roomId)
			{
				return new Response('Room id required.', { status: 400 });
			}
			const id = env.ROOMS.idFromName(roomId);
			const stub = env.ROOMS.get(id);
			return stub.fetch(request);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

interface Env
{
	ROOMS: DurableObjectNamespace;
	ASSETS: Fetcher;
}
