/**
 * Terrain generation pipeline orchestrator.
 * Stage branches are strictly ordered and downstream-invalidating:
 * mesh -> water -> elevation -> rivers -> provinces.
 */
import {
  fingerprintTerrainGenerationControls,
  type TerrainGenerationControls,
} from './controls';
import type {
  TerrainGenerationCache,
  TerrainGenerationConfig,
  TerrainGenerationDirtyFlags,
  TerrainGenerationIteration,
  TerrainGenerationStage,
  TerrainGenerationState,
} from './types';
import { runMeshStage } from './stages/mesh';
import { runWaterStage } from './stages/water';
import { runElevationStage } from './stages/elevation';
import { runRiversStage } from './stages/rivers';
import { runProvincesStage } from './stages/provinces';

function stageRank(stage: TerrainGenerationStage): number {
  switch (stage) {
    case 'mesh':
      return 1;
    case 'water':
      return 2;
    case 'elevation':
      return 3;
    case 'rivers':
      return 4;
    case 'provinces':
      return 5;
    default:
      return 5;
  }
}

function defaultDirtyFlags(): TerrainGenerationDirtyFlags {
  return {
    mesh: true,
    water: true,
    elevation: true,
    rivers: true,
    provinces: true,
  };
}

function cloneCache(cache: TerrainGenerationCache): TerrainGenerationCache {
  return {
    ...cache,
    controls: { ...cache.controls },
  };
}

export function computeGenerationDirty(
  prev: TerrainGenerationControls,
  next: TerrainGenerationControls
): TerrainGenerationDirtyFlags {
  const meshChanged = prev.spacing !== next.spacing || prev.seed !== next.seed;
  const waterChanged =
    prev.waterLevel !== next.waterLevel ||
    prev.waterRoughness !== next.waterRoughness ||
    prev.waterNoiseScale !== next.waterNoiseScale ||
    prev.waterNoiseStrength !== next.waterNoiseStrength ||
    prev.waterNoiseOctaves !== next.waterNoiseOctaves ||
    prev.waterWarpScale !== next.waterWarpScale ||
    prev.waterWarpStrength !== next.waterWarpStrength;
  const elevationChanged =
    prev.landRelief !== next.landRelief ||
    prev.ridgeStrength !== next.ridgeStrength ||
    prev.ridgeCount !== next.ridgeCount ||
    prev.plateauStrength !== next.plateauStrength ||
    prev.ridgeDistribution !== next.ridgeDistribution ||
    prev.ridgeSeparation !== next.ridgeSeparation ||
    prev.ridgeContinuity !== next.ridgeContinuity ||
    prev.ridgeContinuityThreshold !== next.ridgeContinuityThreshold ||
    prev.oceanPeakClamp !== next.oceanPeakClamp ||
    prev.ridgeOceanClamp !== next.ridgeOceanClamp ||
    prev.ridgeWidth !== next.ridgeWidth;
  const riversChanged =
    prev.riverDensity !== next.riverDensity ||
    prev.riverBranchChance !== next.riverBranchChance ||
    prev.riverClimbChance !== next.riverClimbChance;
  const provincesChanged =
    prev.provinceCount !== next.provinceCount ||
    prev.provinceSizeVariance !== next.provinceSizeVariance ||
    prev.provincePassageElevation !== next.provincePassageElevation ||
    prev.provinceRiverPenalty !== next.provinceRiverPenalty ||
    prev.provinceSmallIslandMultiplier !== next.provinceSmallIslandMultiplier ||
    prev.provinceArchipelagoMultiplier !== next.provinceArchipelagoMultiplier ||
    prev.provinceIslandSingleMultiplier !== next.provinceIslandSingleMultiplier ||
    prev.provinceArchipelagoRadiusMultiplier !== next.provinceArchipelagoRadiusMultiplier;

  const mesh = meshChanged;
  const water = mesh || waterChanged;
  const elevation = water || elevationChanged;
  const rivers = elevation || riversChanged;
  const provinces = rivers || provincesChanged;

  return {
    mesh,
    water,
    elevation,
    rivers,
    provinces,
  };
}

export function* iterateTerrainGeneration(args: {
  config: TerrainGenerationConfig;
  controls: TerrainGenerationControls;
  previous?: TerrainGenerationCache | null;
  dirty?: TerrainGenerationDirtyFlags;
  stopAfter?: TerrainGenerationStage;
}): Generator<TerrainGenerationIteration, TerrainGenerationCache> {
  const { config, controls, previous, stopAfter = 'provinces' } = args;
  const dirty = args.dirty ?? (previous ? computeGenerationDirty(previous.controls, controls) : defaultDirtyFlags());
  const initialCache: TerrainGenerationCache = previous
    ? {
        ...cloneCache(previous),
        config: { ...config },
        controls: { ...controls },
        seed: controls.seed >>> 0,
        generationFingerprint: `${config.width}x${config.height}:${fingerprintTerrainGenerationControls(controls)}`,
      }
    : {
        config: { ...config },
        controls: { ...controls },
        seed: controls.seed >>> 0,
        generationFingerprint: `${config.width}x${config.height}:${fingerprintTerrainGenerationControls(controls)}`,
        mesh: null,
        water: null,
        elevation: null,
        rivers: null,
        provinces: null,
      };
  const stopRank = stageRank(stopAfter);
  if (dirty.mesh || !initialCache.mesh) {
    initialCache.mesh = runMeshStage(config, controls);
    initialCache.water = null;
    initialCache.elevation = null;
    initialCache.rivers = null;
    initialCache.provinces = null;
    yield { stage: 'mesh', computed: true, cache: cloneCache(initialCache) };
  } else {
    yield { stage: 'mesh', computed: false, cache: cloneCache(initialCache) };
  }
  if (stopRank <= stageRank('mesh')) {
    return initialCache;
  }

  if (dirty.water || !initialCache.water) {
    initialCache.water = runWaterStage(config, initialCache.mesh, controls);
    initialCache.elevation = null;
    initialCache.rivers = null;
    initialCache.provinces = null;
    yield { stage: 'water', computed: true, cache: cloneCache(initialCache) };
  } else {
    yield { stage: 'water', computed: false, cache: cloneCache(initialCache) };
  }
  if (stopRank <= stageRank('water')) {
    return initialCache;
  }

  if (dirty.elevation || !initialCache.elevation) {
    initialCache.elevation = runElevationStage(initialCache.mesh, initialCache.water, controls);
    initialCache.rivers = null;
    initialCache.provinces = null;
    yield { stage: 'elevation', computed: true, cache: cloneCache(initialCache) };
  } else {
    yield { stage: 'elevation', computed: false, cache: cloneCache(initialCache) };
  }
  if (stopRank <= stageRank('elevation')) {
    return initialCache;
  }

  if (dirty.rivers || !initialCache.rivers) {
    initialCache.rivers = runRiversStage(initialCache.mesh, initialCache.water, controls);
    initialCache.provinces = null;
    yield { stage: 'rivers', computed: true, cache: cloneCache(initialCache) };
  } else {
    yield { stage: 'rivers', computed: false, cache: cloneCache(initialCache) };
  }
  if (stopRank <= stageRank('rivers')) {
    return initialCache;
  }

  if (dirty.provinces || !initialCache.provinces) {
    initialCache.provinces = runProvincesStage(initialCache.mesh, initialCache.water, initialCache.rivers, controls);
    yield { stage: 'provinces', computed: true, cache: cloneCache(initialCache) };
  } else {
    yield { stage: 'provinces', computed: false, cache: cloneCache(initialCache) };
  }

  return initialCache;
}

export function buildTerrainGeneration(args: {
  config: TerrainGenerationConfig;
  controls: TerrainGenerationControls;
  previous?: TerrainGenerationCache | null;
  dirty?: TerrainGenerationDirtyFlags;
  stopAfter?: TerrainGenerationStage;
}): TerrainGenerationCache {
  let result: TerrainGenerationCache | null = null;
  for (const iteration of iterateTerrainGeneration(args)) {
    result = iteration.cache;
  }
  if (result) {
    return result;
  }
  const iterator = iterateTerrainGeneration(args);
  const done = iterator.next();
  if (!done.done) {
    throw new Error('Terrain generation pipeline did not produce a terminal state');
  }
  return done.value;
}

export function toTerrainGenerationState(cache: TerrainGenerationCache): TerrainGenerationState {
  if (!cache.mesh || !cache.water || !cache.elevation || !cache.rivers || !cache.provinces) {
    throw new Error('Terrain generation cache is incomplete');
  }
  return {
    mesh: cache.mesh,
    water: cache.water,
    elevation: cache.elevation,
    rivers: cache.rivers,
    provinces: cache.provinces,
    generationFingerprint: cache.generationFingerprint,
  };
}
