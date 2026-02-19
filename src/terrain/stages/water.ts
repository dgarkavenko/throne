import { createStepRng, generateWater, STEP_SEEDS, type TerrainMeshState } from '../core/terrain-core';
import type { TerrainGenerationControls } from '../controls';
import type { TerrainGenerationConfig } from '../types';

export function runWaterStage(
  config: TerrainGenerationConfig,
  mesh: TerrainMeshState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  return generateWater(config, mesh.mesh, mesh.baseCells, controls, createStepRng(seed, STEP_SEEDS.water));
}
