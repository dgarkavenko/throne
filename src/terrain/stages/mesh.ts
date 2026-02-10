import { createStepRng, generateMesh, STEP_SEEDS } from '../../client/engine/terrain';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../controls';
import type { TerrainGenerationConfig } from '../types';

export function runMeshStage(config: TerrainGenerationConfig, controls: TerrainGenerationControls) {
  const seed = controls.seed >>> 0;
  const legacyControls = toLegacyTerrainControls(controls);
  return generateMesh(config, legacyControls, createStepRng(seed, STEP_SEEDS.mesh));
}

