import { buildRiverTraces, createStepRng, STEP_SEEDS, type TerrainMeshState, type TerrainWaterState } from '../core/terrain-core';
import type { TerrainGenerationControls } from '../controls';

export function runRiversStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  return buildRiverTraces(
    mesh.mesh,
    controls,
    createStepRng(seed, STEP_SEEDS.river),
    water.isLand,
    water.oceanWater
  );
}
