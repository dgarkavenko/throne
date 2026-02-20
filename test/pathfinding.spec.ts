import { describe, expect, it } from 'vitest';
import { addComponent, addEntity, createWorld, hasComponent } from 'bitecs';
import { MoveRequestComponent, PathComponent, TerrainLocationComponent } from '../src/ecs/components';
import { ClientPathfindingRuntime, createPathfindingRuntime } from '../src/client/runtime/pathfinding-runtime';
import type { TerrainGenerationState } from '../src/terrain/types';

type MockTerrainInput = {
	fingerprint: string;
	adjacency: number[][];
	isLand: boolean[];
	points?: Array<{ x: number; y: number }>;
};

function buildTerrainState(input: MockTerrainInput): TerrainGenerationState
{
	const points =
		input.points ?? input.adjacency.map((_, index) => ({ x: index, y: 0 }));
	const mesh = {
		faces: input.adjacency.map((neighbors, index) => ({
			index,
			point: points[index],
			vertices: [],
			adjacentFaces: neighbors.slice(),
			sharedEdges: [],
			edges: [],
		})),
		vertices: [],
		edges: [],
	};
	const isLand = input.isLand.slice();
	const landFaces: number[] = [];
	for (let i = 0; i < isLand.length; i += 1)
	{
		if (isLand[i])
		{
			landFaces.push(i);
		}
	}

	return {
		mesh: mesh as any,
		water: {
			isLand,
			oceanWater: new Array(isLand.length).fill(false),
			waterElevation: new Array(isLand.length).fill(0),
			landDistance: new Array(isLand.length).fill(0),
			landFaces,
			maxLandDistance: 0,
			hasLand: landFaces.length > 0,
			hasWater: landFaces.length < isLand.length,
		},
		elevation: {
			faceElevation: [],
			vertexElevation: [],
			landElevation: [],
		},
		rivers: {
			traces: [],
			riverEdgeMask: [],
		},
		provinces: {} as any,
		generationFingerprint: input.fingerprint,
		generationSeed: 1,
		generationSpacing: 1,
	};
}

describe('client pathfinding runtime', () =>
{
	it('factory returns class runtime instance', () =>
	{
		const runtime = createPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'factory',
				adjacency: [[1], [0]],
				isLand: [true, true],
			})
		);
		expect(runtime).toBeInstanceOf(ClientPathfindingRuntime);
	});

	it('finds path between connected land faces', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'a',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, true, true],
			})
		);

		expect(runtime.findPath(0, 2)).toEqual([0, 1, 2]);
	});

	it('returns null when start or target is water', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'a',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, false, true],
			})
		);

		expect(runtime.findPath(0, 2)).toBeNull();
		expect(runtime.findPath(1, 2)).toBeNull();
	});

	it('returns null for same start and target face', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'a',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, true, true],
			})
		);

		expect(runtime.findPath(1, 1)).toBeNull();
	});

	it('writes path component and removes move request when path exists', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'a',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, true, true],
			})
		);

		const world = createWorld();
		const eid = addEntity(world);
		addComponent(world, eid, TerrainLocationComponent);
		addComponent(world, eid, MoveRequestComponent);
		TerrainLocationComponent.faceId[eid] = 0;
		MoveRequestComponent.toFace[eid] = 2;

		runtime.processMoveRequests(world);

		expect(hasComponent(world, eid, MoveRequestComponent)).toBe(false);
		expect(hasComponent(world, eid, PathComponent)).toBe(true);
		expect(PathComponent.path[eid]).toEqual([0, 1, 2]);
	});

	it('removes move request when no path exists', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'a',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, false, true],
			})
		);

		const world = createWorld();
		const eid = addEntity(world);
		addComponent(world, eid, TerrainLocationComponent);
		addComponent(world, eid, MoveRequestComponent);
		TerrainLocationComponent.faceId[eid] = 0;
		MoveRequestComponent.toFace[eid] = 2;

		runtime.processMoveRequests(world);

		expect(hasComponent(world, eid, MoveRequestComponent)).toBe(false);
		expect(hasComponent(world, eid, PathComponent)).toBe(false);
	});

	it('returns null when face indices are out of bounds', () =>
	{
		const runtime = new ClientPathfindingRuntime(
			buildTerrainState({
				fingerprint: 'bounds',
				adjacency: [[1], [0, 2], [1]],
				isLand: [true, true, true],
			})
		);
		expect(runtime.findPath(-1, 2)).toBeNull();
		expect(runtime.findPath(0, 99)).toBeNull();
	});
});
