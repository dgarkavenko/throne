import { describe, expect, it } from 'vitest';
import { SharedTerrainRuntime } from '../src/client/runtime/shared-terrain-runtime';
import { DEFAULT_TERRAIN_GENERATION_CONTROLS } from '../src/terrain/controls';
import { DEFAULT_TERRAIN_RENDER_CONTROLS } from '../src/client/terrain/render-controls';

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
    const firstPresentation = runtime.getPresentationState();
    const firstFingerprint = runtime.state.terrainState?.generationFingerprint ?? null;

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
    expect(runtime.getPresentationState()).toBe(firstPresentation);
  });

  it('keeps refinement payload stable for non-refinement render-control changes', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
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
    const first = runtime.getPresentationState();
    expect(first).not.toBeNull();

    const result = runtime.setTerrainRenderControls({
      ...DEFAULT_TERRAIN_RENDER_CONTROLS,
      showDualGraph: true,
      provinceBorderWidth: DEFAULT_TERRAIN_RENDER_CONTROLS.provinceBorderWidth + 2,
    });
    const second = runtime.getPresentationState();

    expect(result.changed).toBe(true);
    expect(result.refinementChanged).toBe(false);
    expect(second).not.toBeNull();
    expect(second?.staticRender.refined).toStrictEqual(first?.staticRender.refined);
  });
});
