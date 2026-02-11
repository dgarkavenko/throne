# Throne

Multiplayer strategy prototype on Cloudflare Workers + Durable Objects.

## Architecture
- Server runtime: `src/index.ts`, `src/room.ts`
- Client runtime: `src/client-editor.ts`, `src/client-game.ts`, `src/client/*`
- Rendering: PixiJS (client-only)
- Terrain generation pipeline: `src/terrain/*`

## Route Model
- `/game`: runtime gameplay surface (authoritative snapshots, actor commands)
- `/editor`: terrain editor surface (generation controls + publish)
- `/room/:id`: websocket endpoint backed by the Room Durable Object
- `/`: redirects to `/game`

## Rendering and Preview Ownership
- Terrain rendering is client-side.
- Terrain preview is client-side (editor page).
- Geometry refinement runs client-side as part of render pipeline/cache.
- Server does not render terrain; it validates and simulates gameplay state.
- Server uses generation output (up to required stages) for authoritative pathing/runtime checks.

## Networking Model
- `terrain_publish`: host publishes terrain snapshot from editor.
- `actor_move`: clients submit movement goals.
- `terrain_snapshot`, `world_snapshot`, `actor_command`, `actor_reject`: authoritative server events.
- Legacy `typing` / `launch` / `history` protocol is removed.

## Local Development
1. `npm run build:client`
2. `npm run dev`
3. Open:
   - `http://127.0.0.1:8787/game`
   - `http://127.0.0.1:8787/editor`

Use `?room=<id>` on either route to join/sync a specific room.
