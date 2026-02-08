# Throne

Minimal real-time chat + terrain playground running on Cloudflare Workers with Durable Objects. The server serves a single HTML page and a TypeScript-built client bundle.

**Tech Stack**
- Runtime: Cloudflare Workers + Durable Objects (WebSocket fanout)
- Server language: TypeScript (`src/index.ts`, `src/room.ts`)
- Client language: TypeScript (`src/client.ts` and `src/client/*`)
- Rendering: PixiJS (CDN)
- Physics: Matter.js (CDN)
- Build tools: TypeScript compiler + Wrangler

**How It's Built**
- `src/index.ts` routes:
  - `/` serves the HTML string from `src/html.ts`.
  - `/client.js` and `/client/*` serve static assets from `public/`.
  - `/room/:id` upgrades to a WebSocket handled by the Durable Object.
- `src/room.ts` is the Durable Object that:
  - Accepts WebSocket connections.
  - Tracks connected players, session time, and recent launch history.
  - Broadcasts state updates and launch events to all clients.
- `src/client.ts` is the entry point:
  - Connects to the room WebSocket.
  - Creates UI bindings and updates status/fps/session.
  - Initializes the Pixi/Matter game engine and terrain.
- `src/client/engine/game-engine.ts` orchestrates terrain generation:
  - Terrain basegen (elevation, rivers, mesh creation).
  - Political basegen (province generation) via shared module.
  - Refinement (edge noise, river shaping) and render pipeline.
  - Graph overlay rendering (polygon/dual/corner/center/inserted).
- `src/client/engine/terrain.ts` owns terrain basegen, refinement, and rendering helpers.
- `src/client/engine/political.ts` contains province generation (political basegen).
- `src/client/engine/throne-math.ts` contains shared math utilities (vec ops, lerp, smoothstep, clamp).
- The client build outputs ESM to `public/`:
  - `public/client.js` imports `public/client/*` modules.
  - The HTML loads `/client.js` as a module.

**Run Locally**
1. Build the client:
   - `npm run build:client`
2. Start the worker:
   - `npm run dev`
3. Open:
   - `http://127.0.0.1:8787/`

**Functionality**
- Real-time multi-user presence via WebSockets.
- Live typing display for each connected player.
- Launch messages appear as physics-driven text entities.
- Procedural terrain generation with controls:
  - Spacing
  - Seed
  - Water level
  - Water roughness
  - Optional mesh visualization
- Political province generation (controlled by province count and border options).
- Session timer and FPS display.
- Room selection via query param:
  - `/?room=lobby` (default is `lobby`).
