import type { ProvinceFace, ProvinceGraph } from '../../terrain/core/political-core';
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

export type TerrainPresentationState = {
  staticRender: TerrainStaticRenderModel;
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

export function calculateProvinceCentroid(provinceId: number, terrainState: TerrainGenerationState): Vec2
{
	const province = terrainState.provinces.faces[provinceId];
	let sumX = 0;
	let sumY = 0;
	let count = 0;
	province.faces.forEach((faceIndex) =>
	{
		const point = terrainState.mesh.mesh.faces[faceIndex]?.point;
		if (!point)
		{
			return {x:0, y:0};
		}
		sumX += point.x;
		sumY += point.y;
		count += 1;
	});

	count = Math.max(1, count);
	return { x: sumX / count, y: sumY / count };
}

export function buildBorder(provinceId: number, terrainState: TerrainGenerationState): Vec2[][]
{
	const segments: Vec2[][] = [];
	const provinces = terrainState.provinces;
	const province = terrainState.provinces.faces[provinceId];
	const mesh = terrainState.mesh.mesh;

	province.outerEdges.forEach((edgeIndex) =>
	{
		const outerEdge = provinces.outerEdges[edgeIndex];
		const edge = mesh.edges[outerEdge.edge];
		if (!edge)
		{
			return;
		}
		const a = mesh.vertices[edge.vertices[0]]?.point;
		const b = mesh.vertices[edge.vertices[1]]?.point;
		if (!a || !b)
		{
			return;
		}
		segments.push([a, b]);
	});

	return segments;
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
    )
  };
}
