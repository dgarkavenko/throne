import { applyMountains, createStepRng, STEP_SEEDS, type TerrainMeshState, type TerrainWaterState } from '../core/terrain-core';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../controls';

export function runElevationStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  const legacyControls = toLegacyTerrainControls(controls);
  return applyMountains(mesh.mesh, water, legacyControls, createStepRng(seed, STEP_SEEDS.mountain));
}
