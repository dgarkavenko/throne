import type { TerrainGenerationControls } from './controls';

export type TerrainRefinementControls = {
  intermediateSeed: number;
  intermediateMaxIterations: number;
  intermediateThreshold: number;
  intermediateRelMagnitude: number;
  intermediateAbsMagnitude: number;
};

export type TerrainBorderControls = {
  provinceBorderWidth: number;
  showLandBorders: boolean;
  showShoreBorders: boolean;
};

export type TerrainRenderPassControls = TerrainBorderControls & {
  generationSeed: number;
  generationSpacing: number;
};

export type TerrainRefinementPassControls = TerrainRefinementControls & {
  generationSeed: number;
};

export type TerrainRiverGenerationControls = Pick<
  TerrainGenerationControls,
  'seed' | 'riverDensity' | 'riverBranchChance' | 'riverClimbChance'
>;

export const DEFAULT_TERRAIN_REFINEMENT_CONTROLS: TerrainRefinementControls = {
  intermediateSeed: 1337,
  intermediateMaxIterations: 8,
  intermediateThreshold: 5,
  intermediateRelMagnitude: 0,
  intermediateAbsMagnitude: 2,
};

export const DEFAULT_TERRAIN_BORDER_CONTROLS: TerrainBorderControls = {
  provinceBorderWidth: 6.5,
  showLandBorders: true,
  showShoreBorders: true,
};
