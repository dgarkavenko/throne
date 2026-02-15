# Module Boundaries

## Ownership
- `src/index.ts`, `src/server-game.ts`, `src/room-config.ts`
  - Worker + Durable Object server runtime.
- `src/client/**`
  - Browser-only runtime, UI, networking, and Pixi presentation.
- `src/terrain/**`
  - Shared terrain domain: generation core, stages, runtime helpers, navigation.
- `src/ecs/**`
  - Shared ECS model and pipeline wiring.
- `src/shared/**`
  - Shared protocol/message types used by client + server.

## Dependency Direction
- Allowed:
  - `src/client/**` -> `src/terrain/**`, `src/ecs/**`, `src/shared/**`
  - `src/server*.ts` -> `src/terrain/**`, `src/ecs/**`, `src/shared/**`
  - `src/terrain/**` -> `src/terrain/**`, `src/shared/**` (and standard libs)
- Disallowed:
  - `src/terrain/**` -> `src/client/**`
  - `src/shared/**` -> `src/client/**` or `src/server*.ts`

## Refactor Outcomes
- Terrain core moved out of client namespace:
  - `src/terrain/core/terrain-core.ts`
  - `src/terrain/core/political-core.ts`
  - `src/terrain/core/math.ts`
- Navigation moved to terrain domain:
  - `src/terrain/navigation/pathfinding.ts`
- Terrain runtime helper moved:
  - `src/terrain/runtime/map-system.ts`
- Shared protocol made canonical:
  - `src/shared/protocol.ts`

## Compatibility Shims
- Browser entry shims:
  - `src/client-game.ts` -> starts `src/client/entries/game-entry.ts`
  - `src/client-editor.ts` -> starts `src/client/entries/editor-entry.ts`
- Runtime API shims:
  - `src/client/game/client-game.ts` re-exports from `src/client/runtime/modes.ts`
  - `src/client/game/editor-game.ts` re-exports from `src/client/runtime/modes.ts`
  - `src/client/game/shared-game-runtime.ts` re-exports from `src/client/runtime/shared-runtime.ts`
- Type shim:
  - `src/client/types.ts` re-exports from `src/shared/protocol.ts`

## Build Output Policy
- Generated JS under `public/` is treated as build artifact and not committed.
- Static assets remain committed under `public/assets/**`.
- Client build runs clean step before compile to remove stale generated output.

## Compatibility Timeline
- Current cycle:
  - Keep all shims in place.
  - Migrate internal imports to canonical paths.
- Next cleanup cycle:
  - Remove shim imports from source and tests.
  - Remove shim files after one release window with no external use.
