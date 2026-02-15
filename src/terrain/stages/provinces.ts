import { createStepRng, STEP_SEEDS, type TerrainMeshState, type TerrainWaterState } from '../core/terrain-core';
import { basegenPolitical } from '../core/political-core';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../controls';
import type { TerrainRiverTopologyState } from '../types';

export function runProvincesStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  rivers: TerrainRiverTopologyState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  const legacyControls = toLegacyTerrainControls(controls);
  return basegenPolitical(
    mesh.mesh,
    legacyControls,
    createStepRng(seed, STEP_SEEDS.province),
    water.isLand,
    rivers.riverEdgeMask
  );
}
