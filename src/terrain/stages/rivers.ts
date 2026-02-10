import { buildRiverTraces, createStepRng, STEP_SEEDS, type TerrainMeshState, type TerrainWaterState } from '../../client/engine/terrain';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../controls';

export function runRiversStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  const legacyControls = toLegacyTerrainControls(controls);
  return buildRiverTraces(
    mesh.mesh,
    legacyControls,
    createStepRng(seed, STEP_SEEDS.river),
    water.isLand,
    water.oceanWater
  );
}

