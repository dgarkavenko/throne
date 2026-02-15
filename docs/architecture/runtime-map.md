# Runtime Map

## Overview
Throne has one Worker entrypoint, two browser entry bundles, and one Durable Object runtime.
The browser clients render terrain and consume authoritative snapshots over WebSocket.

## Entrypoints
- Worker entry: `src/index.ts`
- Durable Object runtime: `src/server-game.ts` (`RoomDurableObject`)
- Browser game entry: `src/client-game.ts` -> `src/client/entries/game-entry.ts`
- Browser editor entry: `src/client-editor.ts` -> `src/client/entries/editor-entry.ts`

## Bootstrap Order
1. Worker receives request in `src/index.ts`.
2. Route branch serves HTML (`/game` or `/editor`) or upgrades WebSocket (`/room/:id`).
3. HTML imports either `/client-game.js` or `/client-editor.js`.
4. Top-level shim starts explicit entry function:
   - `startClientGame()` for `/game`
   - `startClientEditor()` for `/editor`
5. Entry initializes:
   - page layout (`createPageLayout`)
   - runtime mode (`ClientGame` or `EditorGame`)
   - room connection (`connectToRoom`)

## Route Branches
### `/`
- Redirects to `/game` (302).

### `/game`
- Serves game HTML with read-only terrain controls plus debug overlays.
- Loads `/client-game.js`.

### `/editor`
- Serves editor HTML with terrain generation controls and publish action.
- Loads `/client-editor.js`.

### `/room/:id`
- Upgrades to WebSocket.
- Forwards to Room Durable Object instance keyed by room id.

## WebSocket Message Branches
### Client -> Server
- `join`
  - Signals client readiness and requests current state/snapshots.
- `terrain_publish`
  - Host-only action to publish terrain controls and map dimensions.

### Server -> Client
- `welcome`
  - Assigns player id.
- `state`
  - Sends players, host id, and session start.
- `terrain_snapshot`
  - Sends terrain controls + terrainVersion.
- `world_snapshot`
  - Sends actor list + snapshot sequence + server time.

## Runtime Role Branches
### Game View (`/game`)
- Always read-only terrain generation controls.
- Host/non-host both receive snapshots.
- World snapshot is accepted only after terrain snapshot has been applied.

### Editor View (`/editor`)
- Settings visible only when identity is known.
- Host:
  - terrain controls enabled
  - publish button visible
- Non-host:
  - terrain controls disabled
  - publish button hidden

## Snapshot Acceptance Branches
### Terrain snapshot branch
- `terrainVersion` updates local terrain version.
- Regenerates terrain from snapshot controls.
- Resets world snapshot sequence gate.

### World snapshot branch
- Gate 1: requires terrain + navigation graph.
  - `ClientGame` throws if world arrives before terrain.
  - `EditorGame` drops it silently when terrain is missing.
- Gate 2: `snapshot.terrainVersion` must equal local `lastTerrainVersion`.
- Gate 3: `snapshot.snapshotSeq` must be strictly greater than last applied sequence.
- If accepted:
  - updates server clock offset estimate
  - upserts actors from snapshot
  - removes stale actors not present in snapshot

## Shared Modules in Runtime Path
- `src/client/runtime/shared-runtime.ts`: shared rendering/input/snapshot behavior.
- `src/terrain/runtime/map-system.ts`: generation controls + dirty-stage regeneration.
- `src/client/terrain/renderer.ts`: terrain draw and overlay control.
- `src/client/ui/layout.ts`: DOM bindings and control-scope branching.
- `src/client/net/connection.ts`: room WebSocket protocol wiring.
