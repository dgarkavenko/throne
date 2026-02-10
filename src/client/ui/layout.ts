type TerrainSettings = {
  spacing: number;
  showPolygonGraph: boolean;
  showDualGraph: boolean;
  showCornerNodes: boolean;
  showCenterNodes: boolean;
  showInsertedPoints: boolean;
  provinceCount: number;
  provinceBorderWidth: number;
  provinceSizeVariance: number;
  provincePassageElevation: number;
  provinceRiverPenalty: number;
  provinceSmallIslandMultiplier: number;
  provinceArchipelagoMultiplier: number;
  provinceIslandSingleMultiplier: number;
  provinceArchipelagoRadiusMultiplier: number;
  showLandBorders: boolean;
  showShoreBorders: boolean;
  landRelief: number;
  ridgeStrength: number;
  ridgeCount: number;
  plateauStrength: number;
  ridgeDistribution: number;
  ridgeSeparation: number;
  ridgeContinuity: number;
  ridgeContinuityThreshold: number;
  oceanPeakClamp: number;
  ridgeOceanClamp: number;
  ridgeWidth: number;
  seed: number;
  intermediateSeed: number;
  intermediateMaxIterations: number;
  intermediateThreshold: number;
  intermediateRelMagnitude: number;
  intermediateAbsMagnitude: number;
  waterLevel: number;
  waterRoughness: number;
  waterNoiseScale: number;
  waterNoiseStrength: number;
  waterNoiseOctaves: number;
  waterWarpScale: number;
  waterWarpStrength: number;
  riverDensity: number;
  riverBranchChance: number;
  riverClimbChance: number;
  agentSpeedScale: number;
  agentTimePerProvinceSeconds: number;
  agentLowlandThreshold: number;
  agentImpassableThreshold: number;
  agentElevationPower: number;
  agentElevationGainK: number;
  agentDebugPaths: boolean;
};

type PageLayout = {
  field: HTMLElement | null;
  setStatus: (message: string) => void;
  setSessionElapsed: (elapsedMs: number | null) => void;
  setFps: (fps: number | null) => void;
  setConnected: (isConnected: boolean) => void;
  getTerrainSettings: () => TerrainSettings;
  onTerrainSettingsChange: (onChange: (settings: TerrainSettings) => void) => void;
};

const TERRAIN_SETTINGS_STORAGE_KEY = 'throne.terrainSettings.v1';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return minutes + ':' + paddedSeconds;
}

export function createPageLayout(): PageLayout {
  const field = document.getElementById('field');
  const statusEl = document.getElementById('status');
  const sessionEl = document.getElementById('session');
  const fpsEl = document.getElementById('fps');
  const terrainSpacingInput = document.getElementById('terrain-spacing') as HTMLInputElement | null;
  const terrainSeedInput = document.getElementById('terrain-seed') as HTMLInputElement | null;
  const terrainIntermediateSeedInput = document.getElementById('terrain-intermediate-seed') as HTMLInputElement | null;
  const terrainIntermediateIterationsInput = document.getElementById('terrain-intermediate-iterations') as HTMLInputElement | null;
  const terrainIntermediateDistanceInput = document.getElementById('terrain-intermediate-distance') as HTMLInputElement | null;
  const terrainIntermediateRelMagnitudeInput = document.getElementById('terrain-intermediate-rel-magnitude') as HTMLInputElement | null;
  const terrainIntermediateAbsMagnitudeInput = document.getElementById('terrain-intermediate-abs-magnitude') as HTMLInputElement | null;
  const terrainWaterLevelInput = document.getElementById('terrain-water-level') as HTMLInputElement | null;
  const terrainWaterRoughnessInput = document.getElementById('terrain-water-roughness') as HTMLInputElement | null;
  const terrainWaterNoiseScaleInput = document.getElementById('terrain-water-noise-scale') as HTMLInputElement | null;
  const terrainWaterNoiseStrengthInput = document.getElementById('terrain-water-noise-strength') as HTMLInputElement | null;
  const terrainWaterNoiseOctavesInput = document.getElementById('terrain-water-noise-octaves') as HTMLInputElement | null;
  const terrainWaterWarpScaleInput = document.getElementById('terrain-water-warp-scale') as HTMLInputElement | null;
  const terrainWaterWarpStrengthInput = document.getElementById('terrain-water-warp-strength') as HTMLInputElement | null;
  const terrainRiverDensityInput = document.getElementById('terrain-river-density') as HTMLInputElement | null;
  const terrainRiverBranchChanceInput = document.getElementById('terrain-river-branch-chance') as HTMLInputElement | null;
  const terrainRiverClimbChanceInput = document.getElementById('terrain-river-climb-chance') as HTMLInputElement | null;
  const terrainGraphPolygonsInput = document.getElementById('terrain-graph-polygons') as HTMLInputElement | null;
  const terrainGraphDualInput = document.getElementById('terrain-graph-dual') as HTMLInputElement | null;
  const terrainGraphCornersInput = document.getElementById('terrain-graph-corners') as HTMLInputElement | null;
  const terrainGraphCentersInput = document.getElementById('terrain-graph-centers') as HTMLInputElement | null;
  const terrainGraphInsertedInput = document.getElementById('terrain-graph-inserted') as HTMLInputElement | null;
  const agentSpeedScaleInput = document.getElementById('agent-speed-scale') as HTMLInputElement | null;
  const agentTimePerProvinceInput = document.getElementById('agent-time-per-province') as HTMLInputElement | null;
  const agentLowlandThresholdInput = document.getElementById('agent-lowland-threshold') as HTMLInputElement | null;
  const agentImpassableThresholdInput = document.getElementById('agent-impassable-threshold') as HTMLInputElement | null;
  const agentElevationPowerInput = document.getElementById('agent-elevation-power') as HTMLInputElement | null;
  const agentElevationGainKInput = document.getElementById('agent-elevation-gain-k') as HTMLInputElement | null;
  const agentDebugPathsInput = document.getElementById('agent-debug-paths') as HTMLInputElement | null;
  const terrainResetButton = document.getElementById('terrain-reset') as HTMLButtonElement | null;
  const terrainProvinceCountInput = document.getElementById('terrain-province-count') as HTMLInputElement | null;
  const terrainProvinceBorderWidthInput = document.getElementById('terrain-province-border-width') as HTMLInputElement | null;
  const terrainProvinceSizeVarianceInput = document.getElementById(
    'terrain-province-size-variance'
  ) as HTMLInputElement | null;
  const terrainProvincePassageElevationInput = document.getElementById(
    'terrain-province-passage-elevation'
  ) as HTMLInputElement | null;
  const terrainProvinceRiverPenaltyInput = document.getElementById(
    'terrain-province-river-penalty'
  ) as HTMLInputElement | null;
  const terrainProvinceSmallIslandMultiplierInput = document.getElementById(
    'terrain-province-small-island'
  ) as HTMLInputElement | null;
  const terrainProvinceArchipelagoMultiplierInput = document.getElementById(
    'terrain-province-archipelago'
  ) as HTMLInputElement | null;
  const terrainProvinceIslandSingleMultiplierInput = document.getElementById(
    'terrain-province-island-single'
  ) as HTMLInputElement | null;
  const terrainProvinceArchipelagoRadiusInput = document.getElementById(
    'terrain-province-archipelago-radius'
  ) as HTMLInputElement | null;
  const terrainProvinceLandBordersInput = document.getElementById('terrain-province-land-borders') as HTMLInputElement | null;
  const terrainProvinceShoreBordersInput = document.getElementById('terrain-province-shore-borders') as HTMLInputElement | null;
  const terrainLandReliefInput = document.getElementById('terrain-land-relief') as HTMLInputElement | null;
  const terrainRidgeStrengthInput = document.getElementById('terrain-ridge-strength') as HTMLInputElement | null;
  const terrainRidgeCountInput = document.getElementById('terrain-ridge-count') as HTMLInputElement | null;
  const terrainPlateauStrengthInput = document.getElementById('terrain-plateau-strength') as HTMLInputElement | null;
  const terrainRidgeDistributionInput = document.getElementById('terrain-ridge-distribution') as HTMLInputElement | null;
  const terrainRidgeSeparationInput = document.getElementById('terrain-ridge-separation') as HTMLInputElement | null;
  const terrainRidgeContinuityInput = document.getElementById('terrain-ridge-continuity') as HTMLInputElement | null;
  const terrainRidgeContinuityThresholdInput = document.getElementById(
    'terrain-ridge-continuity-threshold'
  ) as HTMLInputElement | null;
  const terrainOceanPeakClampInput = document.getElementById('terrain-ocean-peak-clamp') as HTMLInputElement | null;
  const terrainRidgeOceanClampInput = document.getElementById('terrain-ridge-ocean-clamp') as HTMLInputElement | null;
  const terrainRidgeWidthInput = document.getElementById('terrain-ridge-width') as HTMLInputElement | null;
  const terrainSpacingValue = document.getElementById('terrain-spacing-value');
  const terrainIntermediateIterationsValue = document.getElementById('terrain-intermediate-iterations-value');
  const terrainIntermediateDistanceValue = document.getElementById('terrain-intermediate-distance-value');
  const terrainIntermediateRelMagnitudeValue = document.getElementById('terrain-intermediate-rel-magnitude-value');
  const terrainIntermediateAbsMagnitudeValue = document.getElementById('terrain-intermediate-abs-magnitude-value');
  const terrainWaterLevelValue = document.getElementById('terrain-water-level-value');
  const terrainWaterRoughnessValue = document.getElementById('terrain-water-roughness-value');
  const terrainWaterNoiseScaleValue = document.getElementById('terrain-water-noise-scale-value');
  const terrainWaterNoiseStrengthValue = document.getElementById('terrain-water-noise-strength-value');
  const terrainWaterNoiseOctavesValue = document.getElementById('terrain-water-noise-octaves-value');
  const terrainWaterWarpScaleValue = document.getElementById('terrain-water-warp-scale-value');
  const terrainWaterWarpStrengthValue = document.getElementById('terrain-water-warp-strength-value');
  const terrainRiverDensityValue = document.getElementById('terrain-river-density-value');
  const terrainRiverBranchChanceValue = document.getElementById('terrain-river-branch-chance-value');
  const terrainRiverClimbChanceValue = document.getElementById('terrain-river-climb-chance-value');
  const terrainProvinceCountValue = document.getElementById('terrain-province-count-value');
  const terrainProvinceBorderWidthValue = document.getElementById('terrain-province-border-width-value');
  const terrainProvinceSizeVarianceValue = document.getElementById('terrain-province-size-variance-value');
  const terrainProvincePassageElevationValue = document.getElementById(
    'terrain-province-passage-elevation-value'
  );
  const terrainProvinceRiverPenaltyValue = document.getElementById('terrain-province-river-penalty-value');
  const terrainProvinceSmallIslandMultiplierValue = document.getElementById(
    'terrain-province-small-island-value'
  );
  const terrainProvinceArchipelagoMultiplierValue = document.getElementById(
    'terrain-province-archipelago-value'
  );
  const terrainProvinceIslandSingleMultiplierValue = document.getElementById(
    'terrain-province-island-single-value'
  );
  const terrainProvinceArchipelagoRadiusValue = document.getElementById(
    'terrain-province-archipelago-radius-value'
  );
  const terrainLandReliefValue = document.getElementById('terrain-land-relief-value');
  const terrainRidgeStrengthValue = document.getElementById('terrain-ridge-strength-value');
  const terrainRidgeCountValue = document.getElementById('terrain-ridge-count-value');
  const terrainPlateauStrengthValue = document.getElementById('terrain-plateau-strength-value');
  const terrainRidgeDistributionValue = document.getElementById('terrain-ridge-distribution-value');
  const terrainRidgeSeparationValue = document.getElementById('terrain-ridge-separation-value');
  const terrainRidgeContinuityValue = document.getElementById('terrain-ridge-continuity-value');
  const terrainRidgeContinuityThresholdValue = document.getElementById(
    'terrain-ridge-continuity-threshold-value'
  );
  const terrainOceanPeakClampValue = document.getElementById('terrain-ocean-peak-clamp-value');
  const terrainRidgeOceanClampValue = document.getElementById('terrain-ridge-ocean-clamp-value');
  const terrainRidgeWidthValue = document.getElementById('terrain-ridge-width-value');
  const agentSpeedScaleValue = document.getElementById('agent-speed-scale-value');
  const agentTimePerProvinceValue = document.getElementById('agent-time-per-province-value');
  const agentLowlandThresholdValue = document.getElementById('agent-lowland-threshold-value');
  const agentImpassableThresholdValue = document.getElementById('agent-impassable-threshold-value');
  const agentElevationPowerValue = document.getElementById('agent-elevation-power-value');
  const agentElevationGainKValue = document.getElementById('agent-elevation-gain-k-value');

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const parseIntWithFallback = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseFloatWithFallback = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseFloat(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const loadStoredTerrainSettings = (): Partial<TerrainSettings> | null => {
    if (!window.localStorage) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(TERRAIN_SETTINGS_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<TerrainSettings> | null;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const storeTerrainSettings = (settings: TerrainSettings): void => {
    if (!window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(TERRAIN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage failures (e.g., quota exceeded).
    }
  };

  const applyDefaultSettings = (): void => {
    if (terrainSpacingInput) {
      terrainSpacingInput.value = terrainSpacingInput.defaultValue;
    }
    if (terrainSeedInput) {
      terrainSeedInput.value = terrainSeedInput.defaultValue;
    }
    if (terrainIntermediateSeedInput) {
      terrainIntermediateSeedInput.value = terrainIntermediateSeedInput.defaultValue;
    }
    if (terrainIntermediateIterationsInput) {
      terrainIntermediateIterationsInput.value = terrainIntermediateIterationsInput.defaultValue;
    }
    if (terrainIntermediateDistanceInput) {
      terrainIntermediateDistanceInput.value = terrainIntermediateDistanceInput.defaultValue;
    }
    if (terrainIntermediateRelMagnitudeInput) {
      terrainIntermediateRelMagnitudeInput.value = terrainIntermediateRelMagnitudeInput.defaultValue;
    }
    if (terrainIntermediateAbsMagnitudeInput) {
      terrainIntermediateAbsMagnitudeInput.value = terrainIntermediateAbsMagnitudeInput.defaultValue;
    }
    if (terrainWaterLevelInput) {
      terrainWaterLevelInput.value = terrainWaterLevelInput.defaultValue;
    }
    if (terrainWaterRoughnessInput) {
      terrainWaterRoughnessInput.value = terrainWaterRoughnessInput.defaultValue;
    }
    if (terrainWaterNoiseScaleInput) {
      terrainWaterNoiseScaleInput.value = terrainWaterNoiseScaleInput.defaultValue;
    }
    if (terrainWaterNoiseStrengthInput) {
      terrainWaterNoiseStrengthInput.value = terrainWaterNoiseStrengthInput.defaultValue;
    }
    if (terrainWaterNoiseOctavesInput) {
      terrainWaterNoiseOctavesInput.value = terrainWaterNoiseOctavesInput.defaultValue;
    }
    if (terrainWaterWarpScaleInput) {
      terrainWaterWarpScaleInput.value = terrainWaterWarpScaleInput.defaultValue;
    }
    if (terrainWaterWarpStrengthInput) {
      terrainWaterWarpStrengthInput.value = terrainWaterWarpStrengthInput.defaultValue;
    }
    if (terrainRiverDensityInput) {
      terrainRiverDensityInput.value = terrainRiverDensityInput.defaultValue;
    }
    if (terrainRiverBranchChanceInput) {
      terrainRiverBranchChanceInput.value = terrainRiverBranchChanceInput.defaultValue;
    }
    if (terrainRiverClimbChanceInput) {
      terrainRiverClimbChanceInput.value = terrainRiverClimbChanceInput.defaultValue;
    }
    if (terrainProvinceCountInput) {
      terrainProvinceCountInput.value = terrainProvinceCountInput.defaultValue;
    }
    if (terrainProvinceBorderWidthInput) {
      terrainProvinceBorderWidthInput.value = terrainProvinceBorderWidthInput.defaultValue;
    }
    if (terrainProvinceSizeVarianceInput) {
      terrainProvinceSizeVarianceInput.value = terrainProvinceSizeVarianceInput.defaultValue;
    }
    if (terrainProvincePassageElevationInput) {
      terrainProvincePassageElevationInput.value = terrainProvincePassageElevationInput.defaultValue;
    }
    if (terrainProvinceRiverPenaltyInput) {
      terrainProvinceRiverPenaltyInput.value = terrainProvinceRiverPenaltyInput.defaultValue;
    }
    if (terrainProvinceSmallIslandMultiplierInput) {
      terrainProvinceSmallIslandMultiplierInput.value = terrainProvinceSmallIslandMultiplierInput.defaultValue;
    }
    if (terrainProvinceArchipelagoMultiplierInput) {
      terrainProvinceArchipelagoMultiplierInput.value = terrainProvinceArchipelagoMultiplierInput.defaultValue;
    }
    if (terrainProvinceIslandSingleMultiplierInput) {
      terrainProvinceIslandSingleMultiplierInput.value = terrainProvinceIslandSingleMultiplierInput.defaultValue;
    }
    if (terrainProvinceArchipelagoRadiusInput) {
      terrainProvinceArchipelagoRadiusInput.value = terrainProvinceArchipelagoRadiusInput.defaultValue;
    }
    if (terrainProvinceLandBordersInput) {
      terrainProvinceLandBordersInput.checked = terrainProvinceLandBordersInput.defaultChecked;
    }
    if (terrainProvinceShoreBordersInput) {
      terrainProvinceShoreBordersInput.checked = terrainProvinceShoreBordersInput.defaultChecked;
    }
    if (terrainLandReliefInput) {
      terrainLandReliefInput.value = terrainLandReliefInput.defaultValue;
    }
    if (terrainRidgeStrengthInput) {
      terrainRidgeStrengthInput.value = terrainRidgeStrengthInput.defaultValue;
    }
    if (terrainRidgeCountInput) {
      terrainRidgeCountInput.value = terrainRidgeCountInput.defaultValue;
    }
    if (terrainPlateauStrengthInput) {
      terrainPlateauStrengthInput.value = terrainPlateauStrengthInput.defaultValue;
    }
    if (terrainRidgeDistributionInput) {
      terrainRidgeDistributionInput.value = terrainRidgeDistributionInput.defaultValue;
    }
    if (terrainRidgeSeparationInput) {
      terrainRidgeSeparationInput.value = terrainRidgeSeparationInput.defaultValue;
    }
    if (terrainRidgeContinuityInput) {
      terrainRidgeContinuityInput.value = terrainRidgeContinuityInput.defaultValue;
    }
    if (terrainRidgeContinuityThresholdInput) {
      terrainRidgeContinuityThresholdInput.value = terrainRidgeContinuityThresholdInput.defaultValue;
    }
    if (terrainOceanPeakClampInput) {
      terrainOceanPeakClampInput.value = terrainOceanPeakClampInput.defaultValue;
    }
    if (terrainRidgeOceanClampInput) {
      terrainRidgeOceanClampInput.value = terrainRidgeOceanClampInput.defaultValue;
    }
    if (terrainRidgeWidthInput) {
      terrainRidgeWidthInput.value = terrainRidgeWidthInput.defaultValue;
    }
    if (terrainGraphPolygonsInput) {
      terrainGraphPolygonsInput.checked = terrainGraphPolygonsInput.defaultChecked;
    }
    if (terrainGraphDualInput) {
      terrainGraphDualInput.checked = terrainGraphDualInput.defaultChecked;
    }
    if (terrainGraphCornersInput) {
      terrainGraphCornersInput.checked = terrainGraphCornersInput.defaultChecked;
    }
    if (terrainGraphCentersInput) {
      terrainGraphCentersInput.checked = terrainGraphCentersInput.defaultChecked;
    }
    if (terrainGraphInsertedInput) {
      terrainGraphInsertedInput.checked = terrainGraphInsertedInput.defaultChecked;
    }
    if (agentSpeedScaleInput) {
      agentSpeedScaleInput.value = agentSpeedScaleInput.defaultValue;
    }
    if (agentTimePerProvinceInput) {
      agentTimePerProvinceInput.value = agentTimePerProvinceInput.defaultValue;
    }
    if (agentLowlandThresholdInput) {
      agentLowlandThresholdInput.value = agentLowlandThresholdInput.defaultValue;
    }
    if (agentImpassableThresholdInput) {
      agentImpassableThresholdInput.value = agentImpassableThresholdInput.defaultValue;
    }
    if (agentElevationPowerInput) {
      agentElevationPowerInput.value = agentElevationPowerInput.defaultValue;
    }
    if (agentElevationGainKInput) {
      agentElevationGainKInput.value = agentElevationGainKInput.defaultValue;
    }
    if (agentDebugPathsInput) {
      agentDebugPathsInput.checked = agentDebugPathsInput.defaultChecked;
    }
  };

  const applyStoredSettings = (settings: Partial<TerrainSettings>): void => {
    if (typeof settings.spacing === 'number' && terrainSpacingInput) {
      terrainSpacingInput.value = settings.spacing.toString();
    }
    if (typeof settings.seed === 'number' && terrainSeedInput) {
      terrainSeedInput.value = settings.seed.toString();
    }
    if (typeof settings.intermediateSeed === 'number' && terrainIntermediateSeedInput) {
      terrainIntermediateSeedInput.value = settings.intermediateSeed.toString();
    }
    if (typeof settings.intermediateMaxIterations === 'number' && terrainIntermediateIterationsInput) {
      terrainIntermediateIterationsInput.value = settings.intermediateMaxIterations.toString();
    }
    if (typeof settings.intermediateThreshold === 'number' && terrainIntermediateDistanceInput) {
      terrainIntermediateDistanceInput.value = settings.intermediateThreshold.toString();
    }
    if (typeof settings.intermediateRelMagnitude === 'number' && terrainIntermediateRelMagnitudeInput) {
      terrainIntermediateRelMagnitudeInput.value = settings.intermediateRelMagnitude.toString();
    }
    if (typeof settings.intermediateAbsMagnitude === 'number' && terrainIntermediateAbsMagnitudeInput) {
      terrainIntermediateAbsMagnitudeInput.value = settings.intermediateAbsMagnitude.toString();
    }
    if (typeof settings.waterLevel === 'number' && terrainWaterLevelInput) {
      terrainWaterLevelInput.value = settings.waterLevel.toString();
    }
    if (typeof settings.waterRoughness === 'number' && terrainWaterRoughnessInput) {
      terrainWaterRoughnessInput.value = settings.waterRoughness.toString();
    }
    if (typeof settings.waterNoiseScale === 'number' && terrainWaterNoiseScaleInput) {
      terrainWaterNoiseScaleInput.value = settings.waterNoiseScale.toString();
    }
    if (typeof settings.waterNoiseStrength === 'number' && terrainWaterNoiseStrengthInput) {
      terrainWaterNoiseStrengthInput.value = settings.waterNoiseStrength.toString();
    }
    if (typeof settings.waterNoiseOctaves === 'number' && terrainWaterNoiseOctavesInput) {
      terrainWaterNoiseOctavesInput.value = settings.waterNoiseOctaves.toString();
    }
    if (typeof settings.waterWarpScale === 'number' && terrainWaterWarpScaleInput) {
      terrainWaterWarpScaleInput.value = settings.waterWarpScale.toString();
    }
    if (typeof settings.waterWarpStrength === 'number' && terrainWaterWarpStrengthInput) {
      terrainWaterWarpStrengthInput.value = settings.waterWarpStrength.toString();
    }
    if (typeof settings.riverDensity === 'number' && terrainRiverDensityInput) {
      terrainRiverDensityInput.value = settings.riverDensity.toString();
    }
    if (typeof settings.riverBranchChance === 'number' && terrainRiverBranchChanceInput) {
      terrainRiverBranchChanceInput.value = settings.riverBranchChance.toString();
    }
    if (typeof settings.riverClimbChance === 'number' && terrainRiverClimbChanceInput) {
      terrainRiverClimbChanceInput.value = settings.riverClimbChance.toString();
    }
    if (typeof settings.provinceCount === 'number' && terrainProvinceCountInput) {
      terrainProvinceCountInput.value = settings.provinceCount.toString();
    }
    if (typeof settings.provinceBorderWidth === 'number' && terrainProvinceBorderWidthInput) {
      terrainProvinceBorderWidthInput.value = settings.provinceBorderWidth.toString();
    }
    if (typeof settings.provinceSizeVariance === 'number' && terrainProvinceSizeVarianceInput) {
      terrainProvinceSizeVarianceInput.value = settings.provinceSizeVariance.toString();
    }
    if (typeof settings.provincePassageElevation === 'number' && terrainProvincePassageElevationInput) {
      terrainProvincePassageElevationInput.value = settings.provincePassageElevation.toString();
    }
    if (typeof settings.provinceRiverPenalty === 'number' && terrainProvinceRiverPenaltyInput) {
      terrainProvinceRiverPenaltyInput.value = settings.provinceRiverPenalty.toString();
    }
    if (typeof settings.provinceSmallIslandMultiplier === 'number' && terrainProvinceSmallIslandMultiplierInput) {
      terrainProvinceSmallIslandMultiplierInput.value = settings.provinceSmallIslandMultiplier.toString();
    }
    if (typeof settings.provinceArchipelagoMultiplier === 'number' && terrainProvinceArchipelagoMultiplierInput) {
      terrainProvinceArchipelagoMultiplierInput.value = settings.provinceArchipelagoMultiplier.toString();
    }
    if (typeof settings.provinceIslandSingleMultiplier === 'number' && terrainProvinceIslandSingleMultiplierInput) {
      terrainProvinceIslandSingleMultiplierInput.value = settings.provinceIslandSingleMultiplier.toString();
    }
    if (typeof settings.provinceArchipelagoRadiusMultiplier === 'number' && terrainProvinceArchipelagoRadiusInput) {
      terrainProvinceArchipelagoRadiusInput.value = settings.provinceArchipelagoRadiusMultiplier.toString();
    }
    if (typeof settings.showLandBorders === 'boolean' && terrainProvinceLandBordersInput) {
      terrainProvinceLandBordersInput.checked = settings.showLandBorders;
    }
    if (typeof settings.showShoreBorders === 'boolean' && terrainProvinceShoreBordersInput) {
      terrainProvinceShoreBordersInput.checked = settings.showShoreBorders;
    }
    if (typeof settings.landRelief === 'number' && terrainLandReliefInput) {
      terrainLandReliefInput.value = settings.landRelief.toString();
    }
    if (typeof settings.ridgeStrength === 'number' && terrainRidgeStrengthInput) {
      terrainRidgeStrengthInput.value = settings.ridgeStrength.toString();
    }
    if (typeof settings.ridgeCount === 'number' && terrainRidgeCountInput) {
      terrainRidgeCountInput.value = settings.ridgeCount.toString();
    }
    if (typeof settings.plateauStrength === 'number' && terrainPlateauStrengthInput) {
      terrainPlateauStrengthInput.value = settings.plateauStrength.toString();
    }
    if (typeof settings.ridgeDistribution === 'number' && terrainRidgeDistributionInput) {
      terrainRidgeDistributionInput.value = settings.ridgeDistribution.toString();
    }
    if (typeof settings.ridgeSeparation === 'number' && terrainRidgeSeparationInput) {
      terrainRidgeSeparationInput.value = settings.ridgeSeparation.toString();
    }
    if (typeof settings.ridgeContinuity === 'number' && terrainRidgeContinuityInput) {
      terrainRidgeContinuityInput.value = settings.ridgeContinuity.toString();
    }
    if (typeof settings.ridgeContinuityThreshold === 'number' && terrainRidgeContinuityThresholdInput) {
      terrainRidgeContinuityThresholdInput.value = settings.ridgeContinuityThreshold.toString();
    }
    if (typeof settings.oceanPeakClamp === 'number' && terrainOceanPeakClampInput) {
      terrainOceanPeakClampInput.value = settings.oceanPeakClamp.toString();
    }
    if (typeof settings.ridgeOceanClamp === 'number' && terrainRidgeOceanClampInput) {
      terrainRidgeOceanClampInput.value = settings.ridgeOceanClamp.toString();
    }
    if (typeof settings.ridgeWidth === 'number' && terrainRidgeWidthInput) {
      terrainRidgeWidthInput.value = settings.ridgeWidth.toString();
    }
    if (typeof settings.showPolygonGraph === 'boolean' && terrainGraphPolygonsInput) {
      terrainGraphPolygonsInput.checked = settings.showPolygonGraph;
    }
    if (typeof settings.showDualGraph === 'boolean' && terrainGraphDualInput) {
      terrainGraphDualInput.checked = settings.showDualGraph;
    }
    if (typeof settings.showCornerNodes === 'boolean' && terrainGraphCornersInput) {
      terrainGraphCornersInput.checked = settings.showCornerNodes;
    }
    if (typeof settings.showCenterNodes === 'boolean' && terrainGraphCentersInput) {
      terrainGraphCentersInput.checked = settings.showCenterNodes;
    }
    if (typeof settings.showInsertedPoints === 'boolean' && terrainGraphInsertedInput) {
      terrainGraphInsertedInput.checked = settings.showInsertedPoints;
    }
    if (typeof settings.agentSpeedScale === 'number' && agentSpeedScaleInput) {
      agentSpeedScaleInput.value = settings.agentSpeedScale.toString();
    }
    if (typeof settings.agentTimePerProvinceSeconds === 'number' && agentTimePerProvinceInput) {
      agentTimePerProvinceInput.value = settings.agentTimePerProvinceSeconds.toString();
    }
    if (typeof settings.agentLowlandThreshold === 'number' && agentLowlandThresholdInput) {
      agentLowlandThresholdInput.value = settings.agentLowlandThreshold.toString();
    }
    if (typeof settings.agentImpassableThreshold === 'number' && agentImpassableThresholdInput) {
      agentImpassableThresholdInput.value = settings.agentImpassableThreshold.toString();
    }
    if (typeof settings.agentElevationPower === 'number' && agentElevationPowerInput) {
      agentElevationPowerInput.value = settings.agentElevationPower.toString();
    }
    if (typeof settings.agentElevationGainK === 'number' && agentElevationGainKInput) {
      agentElevationGainKInput.value = settings.agentElevationGainK.toString();
    }
    if (typeof settings.agentDebugPaths === 'boolean' && agentDebugPathsInput) {
      agentDebugPathsInput.checked = settings.agentDebugPaths;
    }
  };

  const readTerrainSettings = (): TerrainSettings => {
    const spacing = clamp(parseIntWithFallback(terrainSpacingInput?.value, 16), 16, 128);
    const seed = clamp(parseIntWithFallback(terrainSeedInput?.value, 1337), 0, 0xffffffff);
    const intermediateSeed = clamp(parseIntWithFallback(terrainIntermediateSeedInput?.value, 1337), 0, 0xffffffff);
    const intermediateMaxIterations = clamp(
      parseIntWithFallback(terrainIntermediateIterationsInput?.value, 8),
      0,
      12
    );
    const intermediateThreshold = clamp(parseIntWithFallback(terrainIntermediateDistanceInput?.value, 5), 2, 20);
    const intermediateRelMagnitude = clamp(
      parseFloatWithFallback(terrainIntermediateRelMagnitudeInput?.value, 0),
      0,
      2
    );
    const intermediateAbsMagnitude = clamp(
      parseIntWithFallback(terrainIntermediateAbsMagnitudeInput?.value, 2),
      0,
      10
    );
    const waterLevel = clamp(parseIntWithFallback(terrainWaterLevelInput?.value, -10), -40, 40);
    const waterRoughness = clamp(parseIntWithFallback(terrainWaterRoughnessInput?.value, 60), 0, 100);
    const waterNoiseScale = clamp(parseIntWithFallback(terrainWaterNoiseScaleInput?.value, 2), 2, 60);
    const waterNoiseStrength = clamp(parseFloatWithFallback(terrainWaterNoiseStrengthInput?.value, 0), 0, 1);
    const waterNoiseOctaves = clamp(parseIntWithFallback(terrainWaterNoiseOctavesInput?.value, 1), 1, 6);
    const waterWarpScale = clamp(parseIntWithFallback(terrainWaterWarpScaleInput?.value, 2), 2, 40);
    const waterWarpStrength = clamp(parseFloatWithFallback(terrainWaterWarpStrengthInput?.value, 0.7), 0, 0.8);
    const riverDensity = clamp(parseFloatWithFallback(terrainRiverDensityInput?.value, 1), 0, 2);
    const riverBranchChance = clamp(parseFloatWithFallback(terrainRiverBranchChanceInput?.value, 0.25), 0, 1);
    const riverClimbChance = clamp(parseFloatWithFallback(terrainRiverClimbChanceInput?.value, 0.35), 0, 1);
    const provinceCount = clamp(parseIntWithFallback(terrainProvinceCountInput?.value, 8), 1, 32);
    const provinceBorderWidth = clamp(parseFloatWithFallback(terrainProvinceBorderWidthInput?.value, 6.5), 1, 24);
    const provinceSizeVariance = clamp(
      parseFloatWithFallback(terrainProvinceSizeVarianceInput?.value, 0.4),
      0,
      0.75
    );
    const provincePassageElevation = clamp(
      parseIntWithFallback(terrainProvincePassageElevationInput?.value, 6),
      0,
      32
    );
    const provinceRiverPenalty = clamp(
      parseFloatWithFallback(terrainProvinceRiverPenaltyInput?.value, 0.6),
      0,
      2
    );
    const provinceSmallIslandMultiplier = clamp(
      parseFloatWithFallback(terrainProvinceSmallIslandMultiplierInput?.value, 0.35),
      0,
      1
    );
    const provinceArchipelagoMultiplier = clamp(
      parseFloatWithFallback(terrainProvinceArchipelagoMultiplierInput?.value, 0.2),
      0,
      1
    );
    const provinceIslandSingleMultiplier = clamp(
      parseFloatWithFallback(terrainProvinceIslandSingleMultiplierInput?.value, 1.6),
      1,
      3
    );
    const provinceArchipelagoRadiusMultiplier = clamp(
      parseFloatWithFallback(terrainProvinceArchipelagoRadiusInput?.value, 3),
      1,
      6
    );
    const showLandBorders = Boolean(terrainProvinceLandBordersInput?.checked);
    const showShoreBorders = Boolean(terrainProvinceShoreBordersInput?.checked);
    const landRelief = clamp(parseFloatWithFallback(terrainLandReliefInput?.value, 0.95), 0, 1);
    const ridgeStrength = clamp(parseFloatWithFallback(terrainRidgeStrengthInput?.value, 0.85), 0, 1);
    const ridgeCount = clamp(parseIntWithFallback(terrainRidgeCountInput?.value, 9), 1, 10);
    const plateauStrength = clamp(parseFloatWithFallback(terrainPlateauStrengthInput?.value, 0.8), 0, 1);
    const ridgeDistribution = clamp(parseFloatWithFallback(terrainRidgeDistributionInput?.value, 0.8), 0, 1);
    const ridgeSeparation = clamp(parseFloatWithFallback(terrainRidgeSeparationInput?.value, 0.95), 0, 1);
    const ridgeContinuity = clamp(parseFloatWithFallback(terrainRidgeContinuityInput?.value, 0.25), 0, 1);
    const ridgeContinuityThreshold = clamp(
      parseFloatWithFallback(terrainRidgeContinuityThresholdInput?.value, 0),
      0,
      1
    );
    const oceanPeakClamp = clamp(parseFloatWithFallback(terrainOceanPeakClampInput?.value, 0.05), 0, 1);
    const ridgeOceanClamp = clamp(parseFloatWithFallback(terrainRidgeOceanClampInput?.value, 0.5), 0, 1);
    const ridgeWidth = clamp(parseFloatWithFallback(terrainRidgeWidthInput?.value, 1), 0, 1);
    const showPolygonGraph = Boolean(terrainGraphPolygonsInput?.checked);
    const showDualGraph = Boolean(terrainGraphDualInput?.checked);
    const showCornerNodes = Boolean(terrainGraphCornersInput?.checked);
    const showCenterNodes = Boolean(terrainGraphCentersInput?.checked);
    const showInsertedPoints = Boolean(terrainGraphInsertedInput?.checked);
    const agentSpeedScale = clamp(parseFloatWithFallback(agentSpeedScaleInput?.value, 1), 0, 1);
    const agentTimePerProvinceSeconds = clamp(parseIntWithFallback(agentTimePerProvinceInput?.value, 180), 10, 600);
    const agentLowlandThreshold = clamp(parseIntWithFallback(agentLowlandThresholdInput?.value, 10), 1, 31);
    const agentImpassableThresholdInputValue = clamp(
      parseIntWithFallback(agentImpassableThresholdInput?.value, 28),
      2,
      32
    );
    const agentImpassableThreshold = clamp(Math.max(agentLowlandThreshold + 1, agentImpassableThresholdInputValue), 2, 32);
    const agentElevationPower = clamp(parseFloatWithFallback(agentElevationPowerInput?.value, 0.8), 0.5, 2);
    const agentElevationGainK = clamp(parseFloatWithFallback(agentElevationGainKInput?.value, 1), 0, 4);
    const agentDebugPaths = Boolean(agentDebugPathsInput?.checked);
    return {
      spacing,
      showPolygonGraph,
      showDualGraph,
      showCornerNodes,
      showCenterNodes,
      showInsertedPoints,
      provinceCount,
      provinceBorderWidth,
      provinceSizeVariance,
      provincePassageElevation,
      provinceRiverPenalty,
      provinceSmallIslandMultiplier,
      provinceArchipelagoMultiplier,
      provinceIslandSingleMultiplier,
      provinceArchipelagoRadiusMultiplier,
      showLandBorders,
      showShoreBorders,
      landRelief,
      ridgeStrength,
      ridgeCount,
      plateauStrength,
      ridgeDistribution,
      ridgeSeparation,
      ridgeContinuity,
      ridgeContinuityThreshold,
      oceanPeakClamp,
      ridgeOceanClamp,
      ridgeWidth,
      seed,
      intermediateSeed,
      intermediateMaxIterations,
      intermediateThreshold,
      intermediateRelMagnitude,
      intermediateAbsMagnitude,
      waterLevel,
      waterRoughness,
      waterNoiseScale,
      waterNoiseStrength,
      waterNoiseOctaves,
      waterWarpScale,
      waterWarpStrength,
      riverDensity,
      riverBranchChance,
      riverClimbChance,
      agentSpeedScale,
      agentTimePerProvinceSeconds,
      agentLowlandThreshold,
      agentImpassableThreshold,
      agentElevationPower,
      agentElevationGainK,
      agentDebugPaths,
    };
  };

  const storedSettings = loadStoredTerrainSettings();
  if (storedSettings) {
    applyStoredSettings(storedSettings);
  }

  const syncTerrainLabels = (): void => {
    const settings = readTerrainSettings();
    if (terrainSpacingValue) {
      terrainSpacingValue.textContent = settings.spacing.toString();
    }
    if (terrainIntermediateIterationsValue) {
      terrainIntermediateIterationsValue.textContent = settings.intermediateMaxIterations.toString();
    }
    if (terrainIntermediateDistanceValue) {
      terrainIntermediateDistanceValue.textContent = settings.intermediateThreshold.toString();
    }
    if (terrainIntermediateRelMagnitudeValue) {
      terrainIntermediateRelMagnitudeValue.textContent = settings.intermediateRelMagnitude.toFixed(1);
    }
    if (terrainIntermediateAbsMagnitudeValue) {
      terrainIntermediateAbsMagnitudeValue.textContent = settings.intermediateAbsMagnitude.toString();
    }
    if (terrainWaterLevelValue) {
      terrainWaterLevelValue.textContent = settings.waterLevel.toString();
    }
    if (terrainWaterRoughnessValue) {
      terrainWaterRoughnessValue.textContent = settings.waterRoughness.toString();
    }
    if (terrainWaterNoiseScaleValue) {
      terrainWaterNoiseScaleValue.textContent = settings.waterNoiseScale.toString();
    }
    if (terrainWaterNoiseStrengthValue) {
      terrainWaterNoiseStrengthValue.textContent = settings.waterNoiseStrength.toFixed(2);
    }
    if (terrainWaterNoiseOctavesValue) {
      terrainWaterNoiseOctavesValue.textContent = settings.waterNoiseOctaves.toString();
    }
    if (terrainWaterWarpScaleValue) {
      terrainWaterWarpScaleValue.textContent = settings.waterWarpScale.toString();
    }
    if (terrainWaterWarpStrengthValue) {
      terrainWaterWarpStrengthValue.textContent = settings.waterWarpStrength.toFixed(2);
    }
    if (terrainRiverDensityValue) {
      terrainRiverDensityValue.textContent = settings.riverDensity.toFixed(1);
    }
    if (terrainRiverBranchChanceValue) {
      terrainRiverBranchChanceValue.textContent = settings.riverBranchChance.toFixed(2);
    }
    if (terrainRiverClimbChanceValue) {
      terrainRiverClimbChanceValue.textContent = settings.riverClimbChance.toFixed(2);
    }
    if (terrainProvinceCountValue) {
      terrainProvinceCountValue.textContent = settings.provinceCount.toString();
    }
    if (terrainProvinceBorderWidthValue) {
      terrainProvinceBorderWidthValue.textContent = settings.provinceBorderWidth.toFixed(1);
    }
    if (terrainProvinceSizeVarianceValue) {
      terrainProvinceSizeVarianceValue.textContent = settings.provinceSizeVariance.toFixed(2);
    }
    if (terrainProvincePassageElevationValue) {
      terrainProvincePassageElevationValue.textContent = settings.provincePassageElevation.toString();
    }
    if (terrainProvinceRiverPenaltyValue) {
      terrainProvinceRiverPenaltyValue.textContent = settings.provinceRiverPenalty.toFixed(2);
    }
    if (terrainProvinceSmallIslandMultiplierValue) {
      terrainProvinceSmallIslandMultiplierValue.textContent = settings.provinceSmallIslandMultiplier.toFixed(2);
    }
    if (terrainProvinceArchipelagoMultiplierValue) {
      terrainProvinceArchipelagoMultiplierValue.textContent = settings.provinceArchipelagoMultiplier.toFixed(2);
    }
    if (terrainProvinceIslandSingleMultiplierValue) {
      terrainProvinceIslandSingleMultiplierValue.textContent = settings.provinceIslandSingleMultiplier.toFixed(2);
    }
    if (terrainProvinceArchipelagoRadiusValue) {
      terrainProvinceArchipelagoRadiusValue.textContent =
        settings.provinceArchipelagoRadiusMultiplier.toFixed(1);
    }
    if (terrainLandReliefValue) {
      terrainLandReliefValue.textContent = settings.landRelief.toFixed(2);
    }
    if (terrainRidgeStrengthValue) {
      terrainRidgeStrengthValue.textContent = settings.ridgeStrength.toFixed(2);
    }
    if (terrainRidgeCountValue) {
      terrainRidgeCountValue.textContent = settings.ridgeCount.toString();
    }
    if (terrainPlateauStrengthValue) {
      terrainPlateauStrengthValue.textContent = settings.plateauStrength.toFixed(2);
    }
    if (terrainRidgeDistributionValue) {
      terrainRidgeDistributionValue.textContent = settings.ridgeDistribution.toFixed(2);
    }
    if (terrainRidgeSeparationValue) {
      terrainRidgeSeparationValue.textContent = settings.ridgeSeparation.toFixed(2);
    }
    if (terrainRidgeContinuityValue) {
      terrainRidgeContinuityValue.textContent = settings.ridgeContinuity.toFixed(2);
    }
    if (terrainRidgeContinuityThresholdValue) {
      terrainRidgeContinuityThresholdValue.textContent = settings.ridgeContinuityThreshold.toFixed(2);
    }
    if (terrainOceanPeakClampValue) {
      terrainOceanPeakClampValue.textContent = settings.oceanPeakClamp.toFixed(2);
    }
    if (terrainRidgeOceanClampValue) {
      terrainRidgeOceanClampValue.textContent = settings.ridgeOceanClamp.toFixed(2);
    }
    if (terrainRidgeWidthValue) {
      terrainRidgeWidthValue.textContent = settings.ridgeWidth.toFixed(2);
    }
    if (agentSpeedScaleValue) {
      agentSpeedScaleValue.textContent = settings.agentSpeedScale.toFixed(2);
    }
    if (agentTimePerProvinceValue) {
      agentTimePerProvinceValue.textContent = settings.agentTimePerProvinceSeconds.toString();
    }
    if (agentLowlandThresholdValue) {
      agentLowlandThresholdValue.textContent = settings.agentLowlandThreshold.toString();
    }
    if (agentImpassableThresholdValue) {
      agentImpassableThresholdValue.textContent = settings.agentImpassableThreshold.toString();
    }
    if (agentElevationPowerValue) {
      agentElevationPowerValue.textContent = settings.agentElevationPower.toFixed(2);
    }
    if (agentElevationGainKValue) {
      agentElevationGainKValue.textContent = settings.agentElevationGainK.toFixed(2);
    }
  };

  syncTerrainLabels();

  return {
    field,
    setStatus(message) {
      if (!statusEl) {
        return;
      }
      statusEl.textContent = message;
    },
    setSessionElapsed(elapsedMs) {
      if (!sessionEl) {
        return;
      }
      if (elapsedMs === null) {
        sessionEl.textContent = 'Session: --:--';
        return;
      }
      sessionEl.textContent = formatDuration(elapsedMs);
    },
    setFps(fps) {
      if (!fpsEl) {
        return;
      }
      if (fps === null) {
        fpsEl.textContent = 'FPS: --';
        return;
      }
      fpsEl.textContent = 'FPS: ' + fps;
    },
    setConnected(isConnected) {
      document.body.classList.toggle('connected', isConnected);
    },
    getTerrainSettings() {
      return readTerrainSettings();
    },
    onTerrainSettingsChange(onChange) {
    const notify = () => {
      syncTerrainLabels();
      const settings = readTerrainSettings();
      storeTerrainSettings(settings);
      onChange(settings);
    };
    const reset = () => {
      applyDefaultSettings();
      syncTerrainLabels();
      const settings = readTerrainSettings();
      storeTerrainSettings(settings);
      onChange(settings);
    };
    terrainSpacingInput?.addEventListener('input', notify);
    terrainSeedInput?.addEventListener('change', notify);
    terrainIntermediateSeedInput?.addEventListener('change', notify);
    terrainIntermediateIterationsInput?.addEventListener('input', notify);
    terrainIntermediateDistanceInput?.addEventListener('input', notify);
    terrainIntermediateRelMagnitudeInput?.addEventListener('input', notify);
    terrainIntermediateAbsMagnitudeInput?.addEventListener('input', notify);
    terrainWaterLevelInput?.addEventListener('input', notify);
      terrainWaterRoughnessInput?.addEventListener('input', notify);
      terrainWaterNoiseScaleInput?.addEventListener('input', notify);
      terrainWaterNoiseStrengthInput?.addEventListener('input', notify);
    terrainWaterNoiseOctavesInput?.addEventListener('input', notify);
    terrainWaterWarpScaleInput?.addEventListener('input', notify);
    terrainWaterWarpStrengthInput?.addEventListener('input', notify);
    terrainRiverDensityInput?.addEventListener('input', notify);
    terrainRiverBranchChanceInput?.addEventListener('input', notify);
    terrainRiverClimbChanceInput?.addEventListener('input', notify);
    terrainProvinceCountInput?.addEventListener('input', notify);
    terrainProvinceBorderWidthInput?.addEventListener('input', notify);
    terrainProvinceSizeVarianceInput?.addEventListener('input', notify);
    terrainProvincePassageElevationInput?.addEventListener('input', notify);
    terrainProvinceRiverPenaltyInput?.addEventListener('input', notify);
    terrainProvinceSmallIslandMultiplierInput?.addEventListener('input', notify);
    terrainProvinceArchipelagoMultiplierInput?.addEventListener('input', notify);
    terrainProvinceIslandSingleMultiplierInput?.addEventListener('input', notify);
    terrainProvinceArchipelagoRadiusInput?.addEventListener('input', notify);
    terrainProvinceLandBordersInput?.addEventListener('change', notify);
    terrainProvinceShoreBordersInput?.addEventListener('change', notify);
    terrainLandReliefInput?.addEventListener('input', notify);
    terrainRidgeStrengthInput?.addEventListener('input', notify);
    terrainRidgeCountInput?.addEventListener('input', notify);
    terrainPlateauStrengthInput?.addEventListener('input', notify);
    terrainRidgeDistributionInput?.addEventListener('input', notify);
    terrainRidgeSeparationInput?.addEventListener('input', notify);
    terrainRidgeContinuityInput?.addEventListener('input', notify);
    terrainRidgeContinuityThresholdInput?.addEventListener('input', notify);
    terrainOceanPeakClampInput?.addEventListener('input', notify);
    terrainRidgeOceanClampInput?.addEventListener('input', notify);
    terrainRidgeWidthInput?.addEventListener('input', notify);
    terrainGraphPolygonsInput?.addEventListener('change', notify);
      terrainGraphDualInput?.addEventListener('change', notify);
    terrainGraphCornersInput?.addEventListener('change', notify);
    terrainGraphCentersInput?.addEventListener('change', notify);
    terrainGraphInsertedInput?.addEventListener('change', notify);
    agentSpeedScaleInput?.addEventListener('input', notify);
    agentTimePerProvinceInput?.addEventListener('input', notify);
    agentLowlandThresholdInput?.addEventListener('input', notify);
    agentImpassableThresholdInput?.addEventListener('input', notify);
    agentElevationPowerInput?.addEventListener('input', notify);
    agentElevationGainKInput?.addEventListener('input', notify);
    agentDebugPathsInput?.addEventListener('change', notify);
    terrainResetButton?.addEventListener('click', reset);
    },
  };
}
