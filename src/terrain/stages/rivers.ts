import {
  buildRiverTraces,
  createStepRng,
  STEP_SEEDS,
  type TerrainMeshState,
  type TerrainMountainState,
  type TerrainWaterState,
} from '../core/terrain-core';
import type { TerrainGenerationControls } from '../controls';

export function runRiversStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  elevation: TerrainMountainState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  return buildRiverTraces(
    mesh,
    controls,
    createStepRng(seed, STEP_SEEDS.river),
    water.isLand,
    water.oceanWater,
    elevation.faceElevation
  );
}
