import type { TerrainGenerationControls } from '../../terrain/controls';
import type { ProvinceGraph } from '../../terrain/core/political-core';
import type {
  TerrainMeshState,
  TerrainRefineResult,
  TerrainWaterState,
} from '../../terrain/core/terrain-core';
import type { TerrainRenderControls } from './render-controls';

export type Vec2 = { x: number; y: number };

export type TerrainStaticRenderModel = {
  config: { width: number; height: number };
  generationControls: TerrainGenerationControls;
  renderControls: TerrainRenderControls;
  base: {
    mesh: TerrainMeshState['mesh'];
    baseCells: TerrainMeshState['baseCells'];
    isLand: TerrainWaterState['isLand'];
    oceanWater: TerrainWaterState['oceanWater'];
  };
  provinces: ProvinceGraph;
  refined: TerrainRefineResult;
};

export type ProvincePickModel = {
  facePolygons: Vec2[][];
  faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
  gridSize: number;
  gridColumns: number;
  gridRows: number;
  grid: Map<number, number[]>;
  provinceByFace: number[];
  isLand: boolean[];
};

export type ProvinceOverlayModel = {
  provinceCount: number;
  provinceCentroids: Array<Vec2 | null>;
  provinceBorderPaths: Vec2[][][];
};

export type TerrainPresentationState = {
  staticRender: TerrainStaticRenderModel;
  pick: ProvincePickModel;
  overlay: ProvinceOverlayModel;
};

