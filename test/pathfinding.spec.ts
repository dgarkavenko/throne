import { describe, expect, it } from 'vitest';
import {
	advanceAlongPolyline,
	buildNavigationGraph,
	computeElevationFactor,
	computeTerrainStepFactor,
	createPolylineAdvanceState,
	findFacePathAStar,
	type NavigationGraph,
	type NavigationMesh,
} from '../src/client/engine/pathfinding';

function makeMesh(
	points: Array<{ x: number; y: number }>,
	elevations: number[],
	adjacency: number[][],
	edges: Array<[number, number]>
): NavigationMesh {
	return {
		faces: points.map((point, index) => ({
			index,
			point,
			adjacentFaces: adjacency[index],
			elevation: elevations[index],
		})),
		edges: edges.map((edge) => ({ faces: [edge[0], edge[1]] })),
	};
}

function findEdgeIndex(edges: Array<[number, number]>, a: number, b: number): number {
	for (let i = 0; i < edges.length; i += 1) {
		const [u, v] = edges[i];
		if ((u === a && v === b) || (u === b && v === a)) {
			return i;
		}
	}
	return -1;
}

function dijkstra(graph: NavigationGraph, startFace: number, targetFace: number): number {
	if (!graph.nodes[startFace] || !graph.nodes[targetFace]) {
		return Number.POSITIVE_INFINITY;
	}
	const best = new Array<number>(graph.nodes.length).fill(Number.POSITIVE_INFINITY);
	const visited = new Array<boolean>(graph.nodes.length).fill(false);
	best[startFace] = 0;

	for (let step = 0; step < graph.nodes.length; step += 1) {
		let current = -1;
		let currentCost = Number.POSITIVE_INFINITY;
		for (let i = 0; i < best.length; i += 1) {
			if (visited[i] || best[i] >= currentCost) {
				continue;
			}
			current = i;
			currentCost = best[i];
		}
		if (current < 0 || currentCost === Number.POSITIVE_INFINITY) {
			break;
		}
		if (current === targetFace) {
			return currentCost;
		}
		visited[current] = true;
		const node = graph.nodes[current];
		if (!node) {
			continue;
		}
		for (let i = 0; i < node.neighbors.length; i += 1) {
			const neighbor = node.neighbors[i];
			const next = currentCost + neighbor.stepCost;
			if (next < best[neighbor.neighborFaceId]) {
				best[neighbor.neighborFaceId] = next;
			}
		}
	}

	return best[targetFace];
}

describe('pathfinding', () => {
	it('returns factor 1 for lowlands', () => {
		expect(computeElevationFactor(1, 10, 28, 0.8, 1)).toBe(1);
		expect(computeElevationFactor(10, 10, 28, 0.8, 1)).toBe(1);
	});

	it('treats elevations at or above the impassable threshold as blocked', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		];
		const elevations = [1, 30];
		const adjacency = [[1], [0]];
		const edges: Array<[number, number]> = [[0, 1]];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = [true, true];
		const riverEdgeMask = [false];
		const graph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});

		expect(graph.nodes[0]?.neighbors).toEqual([]);
		expect(findFacePathAStar(graph, 0, 1).facePath).toEqual([]);
	});

	it('applies normalized power elevation curve between thresholds', () => {
		const elevation = 19;
		const low = 10;
		const imp = 28;
		const t = (elevation - low) / (imp - low);
		expect(computeElevationFactor(elevation, low, imp, 0.5, 1)).toBeCloseTo(1 + Math.pow(t, 0.5), 10);
		expect(computeElevationFactor(elevation, low, imp, 1, 1)).toBeCloseTo(1 + t, 10);
		expect(computeElevationFactor(elevation, low, imp, 2, 1)).toBeCloseTo(1 + Math.pow(t, 2), 10);
	});

	it('applies gain k in elevation factor and supports k=0', () => {
		const elevation = 20;
		const low = 10;
		const imp = 26;
		const t = (elevation - low) / (imp - low);
		expect(computeElevationFactor(elevation, low, imp, 1, 0)).toBeCloseTo(1, 10);
		expect(computeElevationFactor(elevation, low, imp, 1, 2.5)).toBeCloseTo(1 + 2.5 * t, 10);
	});

	it('multiplies river factor onto elevation factor', () => {
		const noRiver = computeTerrainStepFactor(19, false, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});
		const withRiver = computeTerrainStepFactor(19, true, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});
		expect(noRiver).not.toBeNull();
		expect(withRiver).toBeCloseTo((noRiver as number) * 1.8, 10);
	});

	it('prefers lower weighted cost over fewer steps with threshold penalties', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];
		const elevations = [1, 32, 1, 1, 1];
		const adjacency = [
			[1, 3],
			[0, 2],
			[1, 4],
			[0, 4],
			[3, 2],
		];
		const edges: Array<[number, number]> = [
			[0, 1],
			[1, 2],
			[0, 3],
			[3, 4],
			[4, 2],
		];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = new Array<boolean>(points.length).fill(true);
		const riverEdgeMask = new Array<boolean>(edges.length).fill(false);
		const graph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});

		const result = findFacePathAStar(graph, 0, 2);
		expect(result.facePath).toEqual([0, 3, 4, 2]);
	});

	it('avoids river-crossing edges when a non-river alternative exists', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];
		const elevations = [1, 1, 1, 1];
		const adjacency = [
			[1, 2],
			[0, 3],
			[0, 3],
			[1, 2],
		];
		const edges: Array<[number, number]> = [
			[0, 1],
			[1, 3],
			[0, 2],
			[2, 3],
		];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = new Array<boolean>(points.length).fill(true);
		const riverEdgeMask = new Array<boolean>(edges.length).fill(false);
		const riverEdge = findEdgeIndex(edges, 1, 3);
		riverEdgeMask[riverEdge] = true;
		const graph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 1,
			elevationGainK: 1,
			riverPenalty: 2,
		});

		const result = findFacePathAStar(graph, 0, 3);
		expect(result.facePath).toEqual([0, 2, 3]);
	});

	it('returns no path for disconnected land regions', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 4, y: 0 },
		];
		const elevations = [1, 1, 1];
		const adjacency = [[1], [0], []];
		const edges: Array<[number, number]> = [[0, 1]];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = new Array<boolean>(points.length).fill(true);
		const riverEdgeMask = new Array<boolean>(edges.length).fill(false);
		const graph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 1,
			elevationGainK: 1,
			riverPenalty: 1,
		});

		const result = findFacePathAStar(graph, 0, 2);
		expect(result.facePath).toEqual([]);
		expect(result.totalCost).toBe(Number.POSITIVE_INFINITY);
	});

	it('matches Dijkstra total cost on the same weighted graph', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
		];
		const elevations = [1, 10, 18, 3, 24, 2];
		const adjacency = [
			[1, 3],
			[0, 2, 4],
			[1, 5],
			[0, 4],
			[1, 3, 5],
			[2, 4],
		];
		const edges: Array<[number, number]> = [
			[0, 1],
			[1, 2],
			[0, 3],
			[1, 4],
			[2, 5],
			[3, 4],
			[4, 5],
		];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = new Array<boolean>(points.length).fill(true);
		const riverEdgeMask = new Array<boolean>(edges.length).fill(false);
		const e1 = findEdgeIndex(edges, 1, 4);
		const e2 = findEdgeIndex(edges, 4, 5);
		riverEdgeMask[e1] = true;
		riverEdgeMask[e2] = true;
		const graph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 1.2,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});

		const result = findFacePathAStar(graph, 0, 5);
		const dijkstraCost = dijkstra(graph, 0, 5);
		expect(result.facePath.length).toBeGreaterThan(0);
		expect(result.totalCost).toBeCloseTo(dijkstraCost, 8);
	});

	it('sanitizes thresholds so impassable stays above lowland', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		];
		const elevations = [31, 32];
		const adjacency = [[1], [0]];
		const edges: Array<[number, number]> = [[0, 1]];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const graph = buildNavigationGraph(mesh, [true, true], [false], {
			lowlandThreshold: 31,
			impassableThreshold: 31,
			elevationPower: 1,
			elevationGainK: 1,
			riverPenalty: 0,
		});

		expect(graph.costParams.lowlandThreshold).toBe(31);
		expect(graph.costParams.impassableThreshold).toBe(32);
		expect(graph.nodes[0]?.neighbors).toEqual([]);
	});

	it('scales movement timing with face-time baseline and terrain factor', () => {
		const timePerFaceSeconds = 180;
		const flatFactor = computeTerrainStepFactor(10, false, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});
		const riverFactor = computeTerrainStepFactor(10, true, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});
		const steepFactor = computeTerrainStepFactor(24, false, {
			lowlandThreshold: 10,
			impassableThreshold: 28,
			elevationPower: 0.8,
			elevationGainK: 1,
			riverPenalty: 0.8,
		});
		const flatEdgeTime = timePerFaceSeconds * (flatFactor as number);
		const riverEdgeTime = timePerFaceSeconds * (riverFactor as number);
		const steepEdgeTime = timePerFaceSeconds * (steepFactor as number);

		expect(flatEdgeTime).toBeCloseTo(180, 8);
		expect(riverEdgeTime).toBeGreaterThan(flatEdgeTime);
		expect(steepEdgeTime).toBeGreaterThan(flatEdgeTime);
		expect((riverFactor as number) / (flatFactor as number)).toBeCloseTo(1.8, 8);
		expect(steepFactor).toBeGreaterThan(flatFactor as number);
	});

	it('changes route preference when k increases', () => {
		const points = [
			{ x: 0, y: 0 }, // 0 start
			{ x: 1, y: 0 }, // 1 steep short
			{ x: 2, y: 0 }, // 2 target
			{ x: 0, y: 1 }, // 3 lowland detour
			{ x: 1, y: 1 }, // 4 lowland detour
		];
		const elevations = [1, 25, 1, 2, 2];
		const adjacency = [
			[1, 3],
			[0, 2],
			[1, 4],
			[0, 4],
			[3, 2],
		];
		const edges: Array<[number, number]> = [
			[0, 1],
			[1, 2],
			[0, 3],
			[3, 4],
			[4, 2],
		];
		const mesh = makeMesh(points, elevations, adjacency, edges);
		const isLand = new Array<boolean>(points.length).fill(true);
		const riverEdgeMask = new Array<boolean>(edges.length).fill(false);
		const lowKGraph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 26,
			elevationPower: 1,
			elevationGainK: 0.2,
			riverPenalty: 0,
		});
		const highKGraph = buildNavigationGraph(mesh, isLand, riverEdgeMask, {
			lowlandThreshold: 10,
			impassableThreshold: 26,
			elevationPower: 1,
			elevationGainK: 4,
			riverPenalty: 0,
		});

		expect(findFacePathAStar(lowKGraph, 0, 2).facePath).toEqual([0, 1, 2]);
		expect(findFacePathAStar(highKGraph, 0, 2).facePath).toEqual([0, 3, 4, 2]);
	});

	it('advances along polyline smoothly without overshoot', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 20, y: 0 },
		];
		let state = createPolylineAdvanceState(points, 10);
		state = advanceAlongPolyline(state, 250);
		expect(state.position.x).toBeCloseTo(2.5, 8);
		expect(state.finished).toBe(false);

		state = advanceAlongPolyline(state, 1000);
		expect(state.segmentIndex).toBe(1);
		expect(state.position.x).toBeCloseTo(12.5, 8);
		expect(state.finished).toBe(false);

		state = advanceAlongPolyline(state, 2000);
		expect(state.finished).toBe(true);
		expect(state.position.x).toBeCloseTo(20, 8);
		expect(state.position.x).toBeLessThanOrEqual(20 + 1e-9);
	});

	it('does not move when speed is zero', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		let state = createPolylineAdvanceState(points, 0);
		state = advanceAlongPolyline(state, 10_000);
		expect(state.position.x).toBe(0);
		expect(state.finished).toBe(false);
	});
});
