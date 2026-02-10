export type TerrainRenderControls = {
  showPolygonGraph: boolean;
  showDualGraph: boolean;
  showCornerNodes: boolean;
  showCenterNodes: boolean;
  showInsertedPoints: boolean;
  provinceBorderWidth: number;
  showLandBorders: boolean;
  showShoreBorders: boolean;
  intermediateSeed: number;
  intermediateMaxIterations: number;
  intermediateThreshold: number;
  intermediateRelMagnitude: number;
  intermediateAbsMagnitude: number;
};

export const DEFAULT_TERRAIN_RENDER_CONTROLS: TerrainRenderControls = {
  showPolygonGraph: false,
  showDualGraph: false,
  showCornerNodes: false,
  showCenterNodes: false,
  showInsertedPoints: false,
  provinceBorderWidth: 6.5,
  showLandBorders: true,
  showShoreBorders: true,
  intermediateSeed: 1337,
  intermediateMaxIterations: 8,
  intermediateThreshold: 5,
  intermediateRelMagnitude: 0,
  intermediateAbsMagnitude: 2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeTerrainRenderControls(
  controlsRaw: Partial<TerrainRenderControls> | null | undefined
): TerrainRenderControls {
  const controls = controlsRaw ?? {};
  const defaults = DEFAULT_TERRAIN_RENDER_CONTROLS;
  return {
    showPolygonGraph: Boolean(controls.showPolygonGraph),
    showDualGraph: Boolean(controls.showDualGraph),
    showCornerNodes: Boolean(controls.showCornerNodes),
    showCenterNodes: Boolean(controls.showCenterNodes),
    showInsertedPoints: Boolean(controls.showInsertedPoints),
    provinceBorderWidth: clamp(readNumber(controls.provinceBorderWidth, defaults.provinceBorderWidth), 1, 24),
    showLandBorders: typeof controls.showLandBorders === 'boolean' ? controls.showLandBorders : defaults.showLandBorders,
    showShoreBorders:
      typeof controls.showShoreBorders === 'boolean' ? controls.showShoreBorders : defaults.showShoreBorders,
    intermediateSeed: clamp(Math.floor(readNumber(controls.intermediateSeed, defaults.intermediateSeed)), 0, 0xffffffff),
    intermediateMaxIterations: clamp(
      Math.round(readNumber(controls.intermediateMaxIterations, defaults.intermediateMaxIterations)),
      0,
      12
    ),
    intermediateThreshold: clamp(
      Math.round(readNumber(controls.intermediateThreshold, defaults.intermediateThreshold)),
      2,
      20
    ),
    intermediateRelMagnitude: clamp(
      readNumber(controls.intermediateRelMagnitude, defaults.intermediateRelMagnitude),
      0,
      2
    ),
    intermediateAbsMagnitude: clamp(
      readNumber(controls.intermediateAbsMagnitude, defaults.intermediateAbsMagnitude),
      0,
      10
    ),
  };
}

export function fingerprintTerrainRenderControls(controls: TerrainRenderControls): string {
  return JSON.stringify([
    controls.showPolygonGraph,
    controls.showDualGraph,
    controls.showCornerNodes,
    controls.showCenterNodes,
    controls.showInsertedPoints,
    controls.provinceBorderWidth,
    controls.showLandBorders,
    controls.showShoreBorders,
    controls.intermediateSeed,
    controls.intermediateMaxIterations,
    controls.intermediateThreshold,
    controls.intermediateRelMagnitude,
    controls.intermediateAbsMagnitude,
  ]);
}

export function hasRefinementControlChange(
  prev: TerrainRenderControls,
  next: TerrainRenderControls
): boolean {
  return (
    prev.intermediateSeed !== next.intermediateSeed ||
    prev.intermediateMaxIterations !== next.intermediateMaxIterations ||
    prev.intermediateThreshold !== next.intermediateThreshold ||
    prev.intermediateRelMagnitude !== next.intermediateRelMagnitude ||
    prev.intermediateAbsMagnitude !== next.intermediateAbsMagnitude
  );
}

export function fingerprintTerrainRefinementControls(controls: TerrainRenderControls): string {
  return JSON.stringify([
    controls.intermediateSeed,
    controls.intermediateMaxIterations,
    controls.intermediateThreshold,
    controls.intermediateRelMagnitude,
    controls.intermediateAbsMagnitude,
  ]);
}
