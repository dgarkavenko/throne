import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  type TerrainGenerationControls,
} from '../src/terrain/controls';
import { buildTerrainGeneration, toTerrainGenerationState } from '../src/terrain/pipeline';
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  type TerrainRenderControls,
} from '../src/client/rendering/render-controls';
import { TerrainRefinementCacheStore } from '../src/client/rendering/refinement-cache';

const CONFIG = { width: 640, height: 360 };

function buildState(controls: TerrainGenerationControls) {
  const cache = buildTerrainGeneration({ config: CONFIG, controls });
  return toTerrainGenerationState(cache);
}

describe('terrain refinement cache', () => {
  it('reuses cached refinement for the same generation/refinement controls', () => {
    const generationControls = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS, seed: 9001 };
    const renderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
    const generationState = buildState(generationControls);
    const cache = new TerrainRefinementCacheStore();
    const first = cache.resolve(generationState, renderControls);
    const second = cache.resolve(generationState, renderControls);
    expect(second).toBe(first);
  });

  it('does not invalidate cache for non-refinement render toggles', () => {
    const generationControls = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS, seed: 42 };
    const generationState = buildState(generationControls);
    const cache = new TerrainRefinementCacheStore();
    const baseRender = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
    const first = cache.resolve(generationState, baseRender);
    const toggledRender: TerrainRenderControls = {
      ...baseRender,
      showDualGraph: !baseRender.showDualGraph,
      provinceBorderWidth: baseRender.provinceBorderWidth + 1,
    };
    const second = cache.resolve(generationState, toggledRender);
    expect(second).toBe(first);
  });

  it('recomputes when refinement controls change', () => {
    const generationControls = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS, seed: 1338 };
    const generationState = buildState(generationControls);
    const cache = new TerrainRefinementCacheStore();
    const first = cache.resolve(generationState, { ...DEFAULT_TERRAIN_RENDER_CONTROLS });
    const changedRender: TerrainRenderControls = {
      ...DEFAULT_TERRAIN_RENDER_CONTROLS,
      intermediateMaxIterations: DEFAULT_TERRAIN_RENDER_CONTROLS.intermediateMaxIterations + 1,
    };
    const second = cache.resolve(generationState, changedRender);
    expect(second).not.toBe(first);
  });

  it('recomputes when generation fingerprint changes', () => {
    const controlsA = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS, seed: 1 };
    const controlsB = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS, seed: 2 };
    const stateA = buildState(controlsA);
    const stateB = buildState(controlsB);
    const cache = new TerrainRefinementCacheStore();
    const renderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
    const first = cache.resolve(stateA, renderControls);
    const second = cache.resolve(stateB, renderControls);
    expect(second).not.toBe(first);
  });
});
