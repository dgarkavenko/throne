import {
  createStepRng,
  STEP_SEEDS,
  type TerrainMeshState,
  type TerrainMountainState,
  type TerrainWaterState,
} from '../core/terrain-core';
import { basegenPolitical } from '../core/political-core';
import type { TerrainGenerationControls } from '../controls';
import type { TerrainRiverTopologyState } from '../types';

export function runProvincesStage(
  mesh: TerrainMeshState,
  water: TerrainWaterState,
  elevation: TerrainMountainState,
  rivers: TerrainRiverTopologyState,
  controls: TerrainGenerationControls
) {
  const seed = controls.seed >>> 0;
  return basegenPolitical(
    mesh,
    controls,
    createStepRng(seed, STEP_SEEDS.province),
    elevation.faceElevation,
    water.isLand,
    rivers.riverEdgeMask
  );
}
