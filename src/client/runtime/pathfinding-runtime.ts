import { addComponent, hasComponent, query, removeComponent, type World } from 'bitecs';
import { MoveRequestComponent, PathComponent, TerrainLocationComponent } from '../../ecs/components';
import { type TerrainMeshState } from '../../terrain/core/terrain-core';
import { vec2Dist } from '../../terrain/core/math';
import type { TerrainGenerationState } from '../../terrain/types';

export function createPathfindingRuntime(state: TerrainGenerationState): ClientPathfindingRuntime
{
	return new ClientPathfindingRuntime(state);
}

export class ClientPathfindingRuntime
{
	private readonly mesh: TerrainMeshState;
	private readonly isLand: boolean[];
	private readonly landNeighbors: number[][];

	constructor(state: TerrainGenerationState)
	{
		this.mesh = state.mesh;
		this.isLand = state.water.isLand;
		this.landNeighbors = this.buildLandNeighbors(state.mesh, state.water.isLand);
	}

	processMoveRequests(world: World): void
	{
		for (const eid of query(world, [MoveRequestComponent, TerrainLocationComponent]))
		{
			const path = this.findPath(TerrainLocationComponent.faceId[eid], MoveRequestComponent.toFace[eid]);
			if (path)
			{
				if (!hasComponent(world, eid, PathComponent))
				{
					addComponent(world, eid, PathComponent);
				}

				PathComponent.path[eid] = path;
			}

			removeComponent(world, eid, MoveRequestComponent);
		}
	}

	findPath(fromFace: number, toFace: number): number[] | null
	{
		if (fromFace === toFace)
		{
			return null;
		}

		if (!this.isFaceIndexValid(fromFace) || !this.isFaceIndexValid(toFace))
		{
			return null;
		}
		if (!this.isLand[fromFace] || !this.isLand[toFace])
		{
			return null;
		}

		return this.findPathOnCachedMesh(fromFace, toFace);
	}

	private isFaceIndexValid(faceId: number): boolean
	{
		return (
			Number.isInteger(faceId) &&
			faceId >= 0 &&
			faceId < this.mesh.faces.length
		);
	}

	private buildLandNeighbors(mesh: TerrainMeshState, isLand: boolean[]): number[][]
	{
		const neighborsByFace: number[][] = new Array(mesh.faces.length);
		for (let faceId = 0; faceId < mesh.faces.length; faceId += 1)
		{
			const neighbors: number[] = [];
			if (isLand[faceId])
			{
				const adjacent = mesh.faces[faceId].adjacentFaces;
				for (let i = 0; i < adjacent.length; i += 1)
				{
					const neighborFace = adjacent[i];
					if (neighborFace >= 0 && neighborFace < mesh.faces.length && isLand[neighborFace])
					{
						neighbors.push(neighborFace);
					}
				}
			}
			neighborsByFace[faceId] = neighbors;
		}
		return neighborsByFace;
	}

	private heuristic(fromFace: number, toFace: number): number
	{
		return vec2Dist(this.mesh.faces[fromFace].point, this.mesh.faces[toFace].point);
	}

	private transitionCost(fromFace: number, toFace: number): number
	{
		const geometric = vec2Dist(this.mesh.faces[fromFace].point, this.mesh.faces[toFace].point);

		// const facePenalty = costModel?.faceEnterCost?.(toFace) ?? 0;
		// const edgePenalty = costModel?.edgeCrossCost?.(viaEdge, fromFace, toFace) ?? 0;
		const facePenalty = 0;
		const edgePenalty = 0;
		return geometric + facePenalty + edgePenalty;
	}

	private findPathOnCachedMesh(fromFace: number, toFace: number): number[] | null
	{
		const n = this.mesh.faces.length;
		const gScore = new Float64Array(n);
		const fScore = new Float64Array(n);
		const cameFrom = new Int32Array(n);
		const inOpen = new Uint8Array(n);

		for (let i = 0; i < n; i += 1)
		{
			gScore[i] = fScore[i] = Infinity;
			cameFrom[i] = -1;
		}

		gScore[fromFace] = 0;
		fScore[fromFace] = this.heuristic(fromFace, toFace);

		const openList: number[] = [fromFace];
		inOpen[fromFace] = 1;

		while (openList.length > 0)
		{
			let bestIdx = 0;
			let current = openList[0];
			for (let i = 1; i < openList.length; i += 1)
			{
				const candidate = openList[i];
				if (fScore[candidate] < fScore[current])
				{
					current = candidate;
					bestIdx = i;
				}
			}

			openList.splice(bestIdx, 1);
			inOpen[current] = 0;

			if (current === toFace)
			{
				return this.constructPath(toFace, cameFrom);
			}

			const neighbors = this.landNeighbors[current] ?? [];
			for (let i = 0; i < neighbors.length; i += 1)
			{
				const adjacentFace = neighbors[i];
				const tentativeG = gScore[current] + this.transitionCost(current, adjacentFace);

				if (tentativeG < gScore[adjacentFace])
				{
					cameFrom[adjacentFace] = current;
					gScore[adjacentFace] = tentativeG;
					fScore[adjacentFace] = tentativeG + this.heuristic(adjacentFace, toFace);

					if (!inOpen[adjacentFace])
					{
						openList.push(adjacentFace);
						inOpen[adjacentFace] = 1;
					}
				}
			}
		}

		return null;
	}

	private constructPath(toFace: number, cameFrom: Int32Array<ArrayBuffer>): number[]
	{
		const path: number[] = [];
		let currentStep = toFace;
		while (currentStep !== -1)
		{
			path.push(currentStep);
			currentStep = cameFrom[currentStep];
		}

		path.reverse();
		return path;
	}
}
