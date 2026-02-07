import { html } from './html';
import { RoomDurableObject } from './room';

export { RoomDurableObject };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    }

    if (url.pathname === '/client.js' || url.pathname.startsWith('/client/')) {
      if (url.pathname.startsWith('/client/')) {
        const lastSegment = url.pathname.split('/').at(-1) ?? '';
        if (lastSegment && !lastSegment.includes('.')) {
          const assetUrl = new URL(request.url);
          assetUrl.pathname = `${url.pathname}.js`;
          return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        }
      }
      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith('/room/')) {
      const roomId = url.pathname.replace('/room/', '').trim();
      if (!roomId) {
        return new Response('Room id required.', { status: 400 });
      }
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}
