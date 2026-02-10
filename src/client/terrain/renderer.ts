import { renderTerrain, updateProvinceBorders } from '../engine/terrain';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationState } from '../../terrain/types';
import type { TerrainRenderControls } from './render-controls';
import {
  TerrainRefinementCacheStore,
  type TerrainRenderRefinementState,
} from './refinement-cache';

type TerrainRenderConfig = {
  width: number;
  height: number;
};

export function renderGeneratedTerrain(args: {
  config: TerrainRenderConfig;
  terrainLayer: any;
  generationState: TerrainGenerationState;
  generationControls: TerrainGenerationControls;
  renderControls: TerrainRenderControls;
  refinementCache: TerrainRefinementCacheStore;
}): TerrainRenderRefinementState {
  const { config, terrainLayer, generationState, generationControls, renderControls, refinementCache } = args;
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
  const refined = refinementCache.resolve(generationState, generationControls, renderControls);
  const base = {
    mesh: generationState.mesh.mesh,
    baseCells: generationState.mesh.baseCells,
    isLand: generationState.water.isLand,
    oceanWater: generationState.water.oceanWater,
  };
  const refinedPayload = { refinedGeometry: refined.refinedGeometry, rivers: refined.rivers };
  renderTerrain(config, legacyControls, terrainLayer, base, generationState.provinces, refinedPayload);
  return refined;
}

export function updateRenderedProvinceBorders(args: {
  terrainLayer: any;
  generationControls: TerrainGenerationControls;
  renderControls: TerrainRenderControls;
}): void {
  const legacyControls = toLegacyTerrainControls(args.generationControls, {
    showPolygonGraph: args.renderControls.showPolygonGraph,
    showDualGraph: args.renderControls.showDualGraph,
    showCornerNodes: args.renderControls.showCornerNodes,
    showCenterNodes: args.renderControls.showCenterNodes,
    showInsertedPoints: args.renderControls.showInsertedPoints,
    provinceBorderWidth: args.renderControls.provinceBorderWidth,
    showLandBorders: args.renderControls.showLandBorders,
    showShoreBorders: args.renderControls.showShoreBorders,
    intermediateSeed: args.renderControls.intermediateSeed,
    intermediateMaxIterations: args.renderControls.intermediateMaxIterations,
    intermediateThreshold: args.renderControls.intermediateThreshold,
    intermediateRelMagnitude: args.renderControls.intermediateRelMagnitude,
    intermediateAbsMagnitude: args.renderControls.intermediateAbsMagnitude,
  });
  updateProvinceBorders(args.terrainLayer, legacyControls);
}

