import { query, World } from 'bitecs';
import type { TerrainGenerationState } from '../../terrain/types';
import { ProvinceComponent } from '../../ecs/components';

export type TerrainSize = { width: number; height: number };
export type Vec2 = { x: number; y: number };

export type ProvincePickModel = {
	facePolygons: Vec2[][];
	faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
	gridSize: number;
	gridColumns: number;
	gridRows: number;
	grid: Map<number, number[]>;
	provinceLUT: number[];
	isLand: boolean[];
};

function pointInPolygon(x: number, y: number, polygon: Vec2[]): boolean
{
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1)
	{
		const xi = polygon[i].x;
		const yi = polygon[i].y;
		const xj = polygon[j].x;
		const yj = polygon[j].y;
		const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersects)
		{
			inside = !inside;
		}
	}
	return inside;
}

function getFacePolygon(terrainState: TerrainGenerationState, faceIndex: number): Vec2[] {
	const face = terrainState.mesh.faces[faceIndex];
	if (!face || face.vertices.length < 3) {
		return [];
	}
	const polygon: Vec2[] = [];
	for (let i = 0; i < face.vertices.length; i += 1) {
		const vertex = terrainState.mesh.vertices[face.vertices[i]];
		if (!vertex) {
			continue;
		}
		polygon.push(vertex.point);
	}
	return polygon;
}

export function buildProvincePickModel(
	size: TerrainSize,
	terrainState: TerrainGenerationState,
	world: World
): ProvincePickModel
{
	const mesh = terrainState.mesh;
	const provinces = terrainState.provinces;
	const faceCount = mesh.faces.length;
	const facePolygons: Vec2[][] = new Array(faceCount);
	const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
	const gridSize = 32;
	const gridColumns = Math.max(1, Math.ceil(size.width / gridSize));
	const gridRows = Math.max(1, Math.ceil(size.height / gridSize));
	const grid = new Map<number, number[]>();

	for (let i = 0; i < faceCount; i += 1)
	{
		const cell = getFacePolygon(terrainState, i);
		if (!cell || cell.length < 3)
		{
			facePolygons[i] = [];
			faceAabbs[i] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
			continue;
		}
		facePolygons[i] = cell;
		let minX = cell[0].x;
		let maxX = cell[0].x;
		let minY = cell[0].y;
		let maxY = cell[0].y;
		for (let j = 1; j < cell.length; j += 1)
		{
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
		for (let gx = startX; gx <= endX; gx += 1)
		{
			for (let gy = startY; gy <= endY; gy += 1)
			{
				const key = gx + gy * gridColumns;
				const bucket = grid.get(key);
				if (bucket)
				{
					bucket.push(i);
				} else
				{
					grid.set(key, [i]);
				}
			}
		}		
	}

	let provinceEntityByFace: number[] = new Array(faceCount).fill(-1);

	const provincesEntities = query(world, [ProvinceComponent])

	for (let faceIndex = 0; faceIndex < faceCount; faceIndex++)
	{
		for (const eid of provincesEntities)
		{
			if (provinces.provinceByFace[faceIndex] == ProvinceComponent.provinceId[eid])
			{
				provinceEntityByFace[faceIndex] = eid;
				break;
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
		provinceLUT: provinceEntityByFace,
		isLand: provinces.isLand,
	};
}

export function pickProvinceIndexAt(
	model: ProvincePickModel,
	worldX: number,
	worldY: number
): number | null
{
	const faceIndex = pickFaceIndexAt(model, worldX, worldY);
	if (faceIndex === null)
	{
		return null;
	}
	if (!model.isLand[faceIndex])
	{
		return null;
	}
	const provinceId = model.provinceLUT[faceIndex];
	return provinceId >= 0 ? provinceId : null;
}

export function pickFaceIndexAt(
	model: ProvincePickModel,
	worldX: number,
	worldY: number
): number
{
	const gridX = Math.floor(worldX / model.gridSize);
	const gridY = Math.floor(worldY / model.gridSize);

	if (gridX < 0 || gridY < 0 || gridX >= model.gridColumns || gridY >= model.gridRows)
	{
		return -1;
	}

	const key = gridX + gridY * model.gridColumns;
	const candidates = model.grid.get(key);
	if (!candidates || candidates.length === 0)
	{
		return -1;
	}
	for (let i = 0; i < candidates.length; i += 1)
	{
		const faceIndex = candidates[i];
		const bounds = model.faceAabbs[faceIndex];
		if (
			worldX < bounds.minX ||
			worldX > bounds.maxX ||
			worldY < bounds.minY ||
			worldY > bounds.maxY
		)
		{
			continue;
		}
		const polygon = model.facePolygons[faceIndex];
		if (!polygon || polygon.length < 3)
		{
			continue;
		}
		if (!pointInPolygon(worldX, worldY, polygon))
		{
			continue;
		}
		return faceIndex;
	}

	return -1;
}
