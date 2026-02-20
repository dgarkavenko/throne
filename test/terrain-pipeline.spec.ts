import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  type TerrainGenerationControls,
} from '../src/terrain/controls';
import {
  buildTerrainGeneration,
  computeGenerationDirty,
  iterateTerrainGeneration,
  toTerrainGenerationState,
} from '../src/terrain/pipeline';

const CONFIG = { width: 512, height: 512 };

function summarize(controls: TerrainGenerationControls): {
  faceCount: number;
  vertexCount: number;
  landCount: number;
  riverEdgeCount: number;
  provinceCount: number;
  faceElevationCount: number;
  vertexElevationCount: number;
  isLandSignature: string;
  riverSignature: string;
  provinceSignature: string;
} {
  const cache = buildTerrainGeneration({ config: CONFIG, controls });
  if (!cache.mesh || !cache.water || !cache.elevation || !cache.rivers || !cache.provinces) {
    throw new Error('Generation cache is incomplete');
  }
  const riverEdgeCount = cache.rivers.riverEdgeMask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  return {
    faceCount: cache.mesh.faces.length,
    vertexCount: cache.mesh.vertices.length,
    landCount: cache.water.landFaces.length,
    riverEdgeCount,
    provinceCount: cache.provinces.faces.length,
    faceElevationCount: cache.elevation.faceElevation.length,
    vertexElevationCount: cache.elevation.vertexElevation.length,
    isLandSignature: cache.water.isLand.map((value) => (value ? '1' : '0')).join(''),
    riverSignature: cache.rivers.riverEdgeMask.map((value) => (value ? '1' : '0')).join(''),
    provinceSignature: cache.provinces.provinceByFace.join(','),
  };
}

describe('terrain generation pipeline', () => {
  it('iterates in downstream stage order', () => {
    const controls: TerrainGenerationControls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      spacing: 48,
    };
    const stages = Array.from(iterateTerrainGeneration({ config: CONFIG, controls })).map((entry) => entry.stage);
    expect(stages).toEqual(['mesh', 'water', 'elevation', 'rivers', 'provinces']);
  });

  it('is deterministic for identical config and controls', () => {
    const controls: TerrainGenerationControls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      seed: 2048,
      spacing: 64,
    };
    const a = summarize(controls);
    const b = summarize(controls);
    expect(a).toEqual(b);
  });

  it('aligns elevation arrays with mesh topology sizes', () => {
    const controls: TerrainGenerationControls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      seed: 4096,
      spacing: 52,
    };
    const summary = summarize(controls);
    expect(summary.faceElevationCount).toBe(summary.faceCount);
    expect(summary.vertexElevationCount).toBe(summary.vertexCount);
  });

  it('recomputes only downstream province stage for province-only changes', () => {
    const prevControls: TerrainGenerationControls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      spacing: 56,
      seed: 777,
    };
    const prev = buildTerrainGeneration({ config: CONFIG, controls: prevControls });
    const nextControls: TerrainGenerationControls = {
      ...prevControls,
      provinceCount: prevControls.provinceCount + 1,
    };
    const dirty = computeGenerationDirty(prevControls, nextControls);
    const iterations = Array.from(
      iterateTerrainGeneration({
        config: CONFIG,
        controls: nextControls,
        previous: prev,
        dirty,
      })
    );
    const computedByStage = new Map(iterations.map((entry) => [entry.stage, entry.computed]));
    expect(computedByStage.get('mesh')).toBe(false);
    expect(computedByStage.get('water')).toBe(false);
    expect(computedByStage.get('elevation')).toBe(false);
    expect(computedByStage.get('rivers')).toBe(false);
    expect(computedByStage.get('provinces')).toBe(true);
  });

  it('includes generation render context in generation state', () => {
    const controls: TerrainGenerationControls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      seed: 9988,
      spacing: 72,
    };
    const cache = buildTerrainGeneration({ config: CONFIG, controls });
    const state = toTerrainGenerationState(cache);
    expect(state.generationSeed).toBe(controls.seed);
    expect(state.generationSpacing).toBe(controls.spacing);
  });
});
