import { applyMountains, createStepRng, STEP_SEEDS, type TerrainMeshState, type TerrainWaterState } from '../core/terrain-core';
import type { TerrainGenerationControls } from '../controls';

export function runElevationStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  return applyMountains(mesh.mesh, water, controls, createStepRng(seed, STEP_SEEDS.mountain));
}
