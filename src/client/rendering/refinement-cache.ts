import { createRng, createStepRng, STEP_SEEDS, terrainRefine } from '../../terrain/core/terrain-core';
import type { TerrainGenerationState } from '../../terrain/types';
import {
  fingerprintTerrainRefinementControls,
  toTerrainRefinementControls,
  type TerrainRenderControls,
} from './render-controls';

type TerrainRefinementPayload = ReturnType<typeof terrainRefine>;

export type TerrainRenderRefinementState = TerrainRefinementPayload & {
  generationFingerprint: string;
  renderFingerprint: string;
};

export class TerrainRefinementCacheStore {
  private cache: TerrainRenderRefinementState | null = null;

  clear(): void {
    this.cache = null;
  }

  resolve(
    generationState: TerrainGenerationState,
    renderControls: TerrainRenderControls
  ): TerrainRenderRefinementState {
    const generationFingerprint = generationState.generationFingerprint;
    const renderFingerprint = fingerprintTerrainRefinementControls(renderControls);
    if (
      this.cache &&
      this.cache.generationFingerprint === generationFingerprint &&
      this.cache.renderFingerprint === renderFingerprint
    ) {
      return this.cache;
    }
    const refinementControls = toTerrainRefinementControls(
      renderControls,
      generationState.generationSeed
    );
    const intermediateRandom = createRng(renderControls.intermediateSeed >>> 0);
    const riverRandom = createStepRng(generationState.generationSeed >>> 0, STEP_SEEDS.river);
    const refined = terrainRefine(
      generationState.mesh,
      generationState.water.isLand,
      generationState.elevation.faceElevation,
      refinementControls,
      intermediateRandom,
      riverRandom,
      generationState.water.oceanWater,
      generationState.rivers.traces
    );
    this.cache = {
      ...refined,
      generationFingerprint,
      renderFingerprint,
    };
    return this.cache;
  }
}
