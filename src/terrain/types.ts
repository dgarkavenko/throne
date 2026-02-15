import type {
  buildRiverTraces,
  TerrainMeshState,
  TerrainMountainState,
  TerrainWaterState,
} from './core/terrain-core';
import type { ProvinceGraph } from './core/political-core';
import type { TerrainGenerationControls } from './controls';

export type TerrainGenerationConfig = {
  width: number;
  height: number;
};

export type TerrainGenerationStage = 'mesh' | 'water' | 'elevation' | 'rivers' | 'provinces';

export type TerrainRiverTopologyState = ReturnType<typeof buildRiverTraces>;

export type TerrainGenerationDirtyFlags = {
  mesh: boolean;
  water: boolean;
  elevation: boolean;
  rivers: boolean;
  provinces: boolean;
};

export type TerrainGenerationCache = {
  config: TerrainGenerationConfig;
  controls: TerrainGenerationControls;
  seed: number;
  generationFingerprint: string;
  mesh: TerrainMeshState | null;
  water: TerrainWaterState | null;
  elevation: TerrainMountainState | null;
  rivers: TerrainRiverTopologyState | null;
  provinces: ProvinceGraph | null;
};

export type TerrainGenerationState = {
  mesh: TerrainMeshState;
  water: TerrainWaterState;
  elevation: TerrainMountainState;
  rivers: TerrainRiverTopologyState;
  provinces: ProvinceGraph;
  generationFingerprint: string;
};

export type TerrainGenerationIteration = {
  stage: TerrainGenerationStage;
  computed: boolean;
  cache: TerrainGenerationCache;
};
