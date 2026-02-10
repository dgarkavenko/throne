import { createRng, createStepRng, STEP_SEEDS, terrainRefine } from '../engine/terrain';
import type { TerrainGenerationState } from '../../terrain/types';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../../terrain/controls';
import {
  fingerprintTerrainRefinementControls,
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
    generationControls: TerrainGenerationControls,
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
    const legacyControls = toLegacyTerrainControls(generationControls, {
      showPolygonGraph: renderControls.showPolygonGraph,
      showDualGraph: renderControls.showDualGraph,
      showCornerNodes: renderControls.showCornerNodes,
      showCenterNodes: renderControls.showCenterNodes,
      showInsertedPoints: renderControls.showInsertedPoints,
      provinceBorderWidth: renderControls.provinceBorderWidth,
      showLandBorders: renderControls.showLandBorders,
      showShoreBorders: renderControls.showShoreBorders,
      intermediateSeed: renderControls.intermediateSeed,
      intermediateMaxIterations: renderControls.intermediateMaxIterations,
      intermediateThreshold: renderControls.intermediateThreshold,
      intermediateRelMagnitude: renderControls.intermediateRelMagnitude,
      intermediateAbsMagnitude: renderControls.intermediateAbsMagnitude,
    });
    const intermediateRandom = createRng(renderControls.intermediateSeed >>> 0);
    const riverRandom = createStepRng(generationControls.seed >>> 0, STEP_SEEDS.river);
    const refined = terrainRefine(
      generationState.mesh.mesh,
      generationState.water.isLand,
      legacyControls,
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
