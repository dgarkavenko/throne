import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationState } from '../../terrain/types';
import type { TerrainRenderRefinementState } from './refinement-cache';
import type {
  ProvinceOverlayModel,
  ProvincePickModel,
  TerrainPresentationState,
  TerrainStaticRenderModel,
  Vec2,
} from './types';
import type { TerrainRenderControls } from './render-controls';

type TerrainSize = { width: number; height: number };

function pointInPolygon(x: number, y: number, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function buildTerrainStaticRenderModel(
  size: TerrainSize,
  terrainState: TerrainGenerationState,
  generationControls: TerrainGenerationControls,
  renderControls: TerrainRenderControls,
  refined: TerrainRenderRefinementState
): TerrainStaticRenderModel {
  return {
    config: { width: size.width, height: size.height },
    generationControls: { ...generationControls },
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

export function buildProvincePickModel(
  size: TerrainSize,
  terrainState: TerrainGenerationState,
  generationControls: TerrainGenerationControls
): ProvincePickModel {
  const meshState = terrainState.mesh;
  const provinces = terrainState.provinces;
  const faceCount = meshState.mesh.faces.length;
  const facePolygons: Vec2[][] = new Array(faceCount);
  const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
  const gridSize = Math.max(32, generationControls.spacing * 2);
  const gridColumns = Math.max(1, Math.ceil(size.width / gridSize));
  const gridRows = Math.max(1, Math.ceil(size.height / gridSize));
  const grid = new Map<number, number[]>();

  for (let i = 0; i < faceCount; i += 1) {
    const cell = meshState.baseCells[i];
    if (!cell || cell.length < 3) {
      facePolygons[i] = [];
      faceAabbs[i] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      continue;
    }
    facePolygons[i] = cell;
    let minX = cell[0].x;
    let maxX = cell[0].x;
    let minY = cell[0].y;
    let maxY = cell[0].y;
    for (let j = 1; j < cell.length; j += 1) {
      const point = cell[j];
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    faceAabbs[i] = { minX, minY, maxX, maxY };
    const startX = Math.max(0, Math.floor(minX / gridSize));
    const endX = Math.min(gridColumns - 1, Math.floor(maxX / gridSize));
    const startY = Math.max(0, Math.floor(minY / gridSize));
    const endY = Math.min(gridRows - 1, Math.floor(maxY / gridSize));
    for (let gx = startX; gx <= endX; gx += 1) {
      for (let gy = startY; gy <= endY; gy += 1) {
        const key = gx + gy * gridColumns;
        const bucket = grid.get(key);
        if (bucket) {
          bucket.push(i);
        } else {
          grid.set(key, [i]);
        }
      }
    }
  }

  return {
    facePolygons,
    faceAabbs,
    gridSize,
    gridColumns,
    gridRows,
    grid,
    provinceByFace: provinces.provinceByFace,
    isLand: provinces.isLand,
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
  generationControls: TerrainGenerationControls,
  renderControls: TerrainRenderControls,
  refined: TerrainRenderRefinementState
): TerrainPresentationState {
  return {
    staticRender: buildTerrainStaticRenderModel(
      size,
      terrainState,
      generationControls,
      renderControls,
      refined
    ),
    pick: buildProvincePickModel(size, terrainState, generationControls),
    overlay: buildProvinceOverlayModel(terrainState),
  };
}

export function pickProvinceAt(
  model: ProvincePickModel,
  worldX: number,
  worldY: number
): number | null {
  const gridX = Math.floor(worldX / model.gridSize);
  const gridY = Math.floor(worldY / model.gridSize);
  if (gridX < 0 || gridY < 0 || gridX >= model.gridColumns || gridY >= model.gridRows) {
    return null;
  }
  const key = gridX + gridY * model.gridColumns;
  const candidates = model.grid.get(key);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const faceIndex = candidates[i];
    const bounds = model.faceAabbs[faceIndex];
    if (
      worldX < bounds.minX ||
      worldX > bounds.maxX ||
      worldY < bounds.minY ||
      worldY > bounds.maxY
    ) {
      continue;
    }
    const polygon = model.facePolygons[faceIndex];
    if (!polygon || polygon.length < 3) {
      continue;
    }
    if (!pointInPolygon(worldX, worldY, polygon)) {
      continue;
    }
    if (!model.isLand[faceIndex]) {
      return null;
    }
    const provinceId = model.provinceByFace[faceIndex];
    return provinceId >= 0 ? provinceId : null;
  }
  return null;
}

