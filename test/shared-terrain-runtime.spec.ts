import { describe, expect, it } from 'vitest';
import { SharedTerrainRuntime } from '../src/client/runtime/shared-terrain-runtime';
import { DEFAULT_TERRAIN_GENERATION_CONTROLS } from '../src/terrain/controls';

const SIZE = { width: 640, height: 360 };

describe('shared terrain runtime', () => {
  it('applies only the first terrain snapshot', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    const firstSnapshot = {
      controls: {
        ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
        seed: 101,
        spacing: 32,
      },
      mapWidth: SIZE.width,
      mapHeight: SIZE.height,
    };
    runtime.applyTerrainSnapshot(firstSnapshot, 7);
    const firstTerrainState = runtime.state.terrainState;
    const firstFingerprint = firstTerrainState?.generationFingerprint ?? null;

    runtime.applyTerrainSnapshot(
      {
        controls: {
          ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
          seed: 202,
          spacing: 64,
        },
        mapWidth: SIZE.width,
        mapHeight: SIZE.height,
      },
      8
    );

    expect(runtime.state.lastTerrainVersion).toBe(7);
    expect(runtime.state.generationControls.seed).toBe(firstSnapshot.controls.seed);
    expect(runtime.state.generationControls.spacing).toBe(firstSnapshot.controls.spacing);
    expect(runtime.state.terrainState?.generationFingerprint ?? null).toBe(firstFingerprint);
    expect(runtime.state.terrainState).toBe(firstTerrainState);
    expect(runtime.mapWidth).toBe(SIZE.width);
    expect(runtime.mapHeight).toBe(SIZE.height);
  });

  it('exposes terrain state only after terrain is available', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    expect(runtime.state.terrainState).toBeNull();

    runtime.applyTerrainSnapshot(
      {
        controls: {
          ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
          seed: 99,
        },
        mapWidth: SIZE.width,
        mapHeight: SIZE.height,
      },
      1
    );

    expect(runtime.state.terrainState).not.toBeNull();
    expect(runtime.state.generationControls.seed).toBe(99);
  });
});
