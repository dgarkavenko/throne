import type { ProvinceGraph } from '../../terrain/core/political-core';
import type {
  TerrainMeshState,
  TerrainRefineResult,
  TerrainWaterState,
} from '../../terrain/core/terrain-core';
import type { TerrainGenerationState } from '../../terrain/types';
import type { TerrainRenderRefinementState } from './refinement-cache';
import type { TerrainRenderControls } from './render-controls';

export type TerrainSize = { width: number; height: number };
export type Vec2 = { x: number; y: number };

export type TerrainStaticRenderModel = {
  config: { width: number; height: number };
  generationSeed: number;
  generationSpacing: number;
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

export type ProvinceOverlayModel = {
  provinceCount: number;
  provinceCentroids: Array<Vec2 | null>;
  provinceBorderPaths: Vec2[][][];
};

export type TerrainPresentationState = {
  staticRender: TerrainStaticRenderModel;
  overlay: ProvinceOverlayModel;
};

export function buildTerrainStaticRenderModel(
  size: TerrainSize,
  terrainState: TerrainGenerationState,
  renderControls: TerrainRenderControls,
  refined: TerrainRenderRefinementState
): TerrainStaticRenderModel {
  return {
    config: { width: size.width, height: size.height },
    generationSeed: terrainState.generationSeed,
    generationSpacing: terrainState.generationSpacing,
    renderControls: { ...renderControls },
    base: {
      mesh: terrainState.mesh.mesh,
      baseCells: terrainState.mesh.baseCells,
      isLand: terrainState.water.isLand,
      oceanWater: terrainState.water.oceanWater,
    },
    provinces: terrainState.provinces,
    refined: {
      refinedGeometry: refined.refinedGeometry,
      rivers: refined.rivers,
    },
  };
}

export function buildProvinceOverlayModel(terrainState: TerrainGenerationState): ProvinceOverlayModel {
  const mesh = terrainState.mesh.mesh;
  const provinces = terrainState.provinces;
  const provinceCentroids: Array<Vec2 | null> = new Array(provinces.faces.length).fill(null);
  provinces.faces.forEach((province, index) => {
    if (!province.faces || province.faces.length === 0) {
      provinceCentroids[index] = null;
      return;
    }
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    province.faces.forEach((faceIndex) => {
      const point = mesh.faces[faceIndex]?.point;
      if (!point) {
        return;
      }
      sumX += point.x;
      sumY += point.y;
      count += 1;
    });
    provinceCentroids[index] = count > 0 ? { x: sumX / count, y: sumY / count } : null;
  });

  const provinceBorderPaths: Vec2[][][] = new Array(provinces.faces.length);
  provinces.faces.forEach((province, index) => {
    const segments: Vec2[][] = [];
    province.outerEdges.forEach((edgeIndex) => {
      const outerEdge = provinces.outerEdges[edgeIndex];
      const edge = mesh.edges[outerEdge.edge];
      if (!edge) {
        return;
      }
      const a = mesh.vertices[edge.vertices[0]]?.point;
      const b = mesh.vertices[edge.vertices[1]]?.point;
      if (!a || !b) {
        return;
      }
      segments.push([a, b]);
    });
    provinceBorderPaths[index] = segments;
  });

  return {
    provinceCount: provinces.faces.length,
    provinceCentroids,
    provinceBorderPaths,
  };
}

export function buildTerrainPresentationState(
  size: TerrainSize,
  terrainState: TerrainGenerationState,
  renderControls: TerrainRenderControls,
  refined: TerrainRenderRefinementState
): TerrainPresentationState {
  return {
    staticRender: buildTerrainStaticRenderModel(
      size,
      terrainState,
      renderControls,
      refined
    ),
    overlay: buildProvinceOverlayModel(terrainState),
  };
}
