import { createStepRng, generateMesh, STEP_SEEDS } from '../core/terrain-core';
import type { TerrainGenerationControls } from '../controls';
import type { TerrainGenerationConfig } from '../types';

export function runMeshStage(config: TerrainGenerationConfig, controls: TerrainGenerationControls) {
  const seed = controls.seed >>> 0;
  return generateMesh(config, controls, createStepRng(seed, STEP_SEEDS.mesh));
}
