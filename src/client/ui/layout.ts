type TerrainSettings = {
  spacing: number;
  showPolygonGraph: boolean;
  showDualGraph: boolean;
  showCornerNodes: boolean;
  showCenterNodes: boolean;
  showInsertedPoints: boolean;
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
  const terrainGraphPolygonsInput = document.getElementById('terrain-graph-polygons') as HTMLInputElement | null;
  const terrainGraphDualInput = document.getElementById('terrain-graph-dual') as HTMLInputElement | null;
  const terrainGraphCornersInput = document.getElementById('terrain-graph-corners') as HTMLInputElement | null;
  const terrainGraphCentersInput = document.getElementById('terrain-graph-centers') as HTMLInputElement | null;
  const terrainGraphInsertedInput = document.getElementById('terrain-graph-inserted') as HTMLInputElement | null;
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

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const parseIntWithFallback = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseFloatWithFallback = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseFloat(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const readTerrainSettings = (): TerrainSettings => {
    const spacing = clamp(parseIntWithFallback(terrainSpacingInput?.value, 32), 16, 128);
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
      parseIntWithFallback(terrainIntermediateAbsMagnitudeInput?.value, 5),
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
    const showPolygonGraph = Boolean(terrainGraphPolygonsInput?.checked);
    const showDualGraph = Boolean(terrainGraphDualInput?.checked);
    const showCornerNodes = Boolean(terrainGraphCornersInput?.checked);
    const showCenterNodes = Boolean(terrainGraphCentersInput?.checked);
    const showInsertedPoints = Boolean(terrainGraphInsertedInput?.checked);
    return {
      spacing,
      showPolygonGraph,
      showDualGraph,
      showCornerNodes,
      showCenterNodes,
      showInsertedPoints,
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
    };
  };

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
      onChange(readTerrainSettings());
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
      terrainGraphPolygonsInput?.addEventListener('change', notify);
      terrainGraphDualInput?.addEventListener('change', notify);
      terrainGraphCornersInput?.addEventListener('change', notify);
      terrainGraphCentersInput?.addEventListener('change', notify);
      terrainGraphInsertedInput?.addEventListener('change', notify);
    },
  };
}
