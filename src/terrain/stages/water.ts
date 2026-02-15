import { createStepRng, generateWater, STEP_SEEDS, type TerrainMeshState } from '../core/terrain-core';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../controls';
import type { TerrainGenerationConfig } from '../types';

export function runWaterStage(
  config: TerrainGenerationConfig,
  mesh: TerrainMeshState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  const legacyControls = toLegacyTerrainControls(controls);
  return generateWater(config, mesh.mesh, mesh.baseCells, legacyControls, createStepRng(seed, STEP_SEEDS.water));
}
