export type Vec2 = { x: number; y: number };

export type PathfindingCostParams = {
	lowlandThreshold: number;
	impassableThreshold: number;
	elevationPower: number;
	elevationGainK: number;
	riverPenalty: number;
};

export type NavigationMeshFace = {
	index: number;
	point: Vec2;
	adjacentFaces: number[];
	elevation: number;
};

export type NavigationMeshEdge = {
	faces: [number, number];
};

export type NavigationMesh = {
	faces: NavigationMeshFace[];
	edges: NavigationMeshEdge[];
};

export type NavigationNeighbor = {
	neighborFaceId: number;
	edgeId: number;
	stepCost: number;
};

export type NavigationNode = {
	faceId: number;
	point: Vec2;
	neighbors: NavigationNeighbor[];
};

export type NavigationGraph = {
	nodes: Array<NavigationNode | null>;
	landFaceIds: number[];
	costParams: PathfindingCostParams;
	maxStepDistance: number;
};

export type FacePathResult = {
	facePath: number[];
	totalCost: number;
};

export type PolylineAdvanceState = {
	points: Vec2[];
	segmentIndex: number;
	segmentT: number;
	speedPxPerSec: number;
	position: Vec2;
	finished: boolean;
};

const EPSILON = 1e-6;

export function buildFaceNeighborEdgeLookup(mesh: NavigationMesh): Array<Map<number, number>> {
	const lookup: Array<Map<number, number>> = new Array(mesh.faces.length);
	for (let i = 0; i < mesh.faces.length; i += 1) {
		lookup[i] = new Map<number, number>();
	}
	for (let edgeIndex = 0; edgeIndex < mesh.edges.length; edgeIndex += 1) {
		const edge = mesh.edges[edgeIndex];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		lookup[faceA].set(faceB, edgeIndex);
		lookup[faceB].set(faceA, edgeIndex);
	}
	return lookup;
}

export function buildNavigationGraph(
	mesh: NavigationMesh,
	isLand: boolean[],
	riverEdgeMask: boolean[],
	params: PathfindingCostParams
): NavigationGraph {
	const clampedParams = sanitizePathfindingCostParams(params);
	const faceNeighborEdges = buildFaceNeighborEdgeLookup(mesh);
	const nodes: Array<NavigationNode | null> = new Array(mesh.faces.length).fill(null);
	const landFaceIds: number[] = [];
	let maxStepDistance = 0;

	for (let faceId = 0; faceId < mesh.faces.length; faceId += 1) {
		if (!isLand[faceId]) {
			continue;
		}
		const face = mesh.faces[faceId];
		if (
			computeElevationFactor(
				face.elevation,
				clampedParams.lowlandThreshold,
				clampedParams.impassableThreshold,
				clampedParams.elevationPower,
				clampedParams.elevationGainK
			) === null
		) {
			continue;
		}
		const neighbors: NavigationNeighbor[] = [];
		for (let i = 0; i < face.adjacentFaces.length; i += 1) {
			const neighborFaceId = face.adjacentFaces[i];
			if (!isLand[neighborFaceId]) {
				continue;
			}
			const edgeId = faceNeighborEdges[faceId].get(neighborFaceId);
			if (edgeId === undefined) {
				continue;
			}
			const neighborFace = mesh.faces[neighborFaceId];
			const stepDistance = distance(face.point, neighborFace.point);
			if (stepDistance > maxStepDistance) {
				maxStepDistance = stepDistance;
			}
			const crossedRiver = Boolean(riverEdgeMask[edgeId]);
			const stepCost = computeTerrainStepFactor(
				neighborFace.elevation,
				crossedRiver,
				clampedParams
			);
			if (stepCost === null || !Number.isFinite(stepCost) || stepCost <= 0) {
				continue;
			}
			neighbors.push({ neighborFaceId, edgeId, stepCost });
		}
		neighbors.sort((a, b) => a.neighborFaceId - b.neighborFaceId);
		nodes[faceId] = { faceId, point: face.point, neighbors };
		landFaceIds.push(faceId);
	}

	return {
		nodes,
		landFaceIds,
		costParams: clampedParams,
		maxStepDistance,
	};
}

export function findFacePathAStar(
	graph: NavigationGraph,
	startFace: number,
	targetFace: number
): FacePathResult {
	if (startFace === targetFace) {
		return { facePath: [startFace], totalCost: 0 };
	}
	const startNode = graph.nodes[startFace];
	const targetNode = graph.nodes[targetFace];
	if (!startNode || !targetNode) {
		return { facePath: [], totalCost: Number.POSITIVE_INFINITY };
	}

	const faceCount = graph.nodes.length;
	const gScore = new Array<number>(faceCount).fill(Number.POSITIVE_INFINITY);
	const fScore = new Array<number>(faceCount).fill(Number.POSITIVE_INFINITY);
	const cameFrom = new Array<number>(faceCount).fill(-1);
	const closed = new Array<boolean>(faceCount).fill(false);
	const open = new MinHeap();

	gScore[startFace] = 0;
	fScore[startFace] = heuristic(startNode.point, targetNode.point, graph.maxStepDistance);
	open.push({ faceId: startFace, score: fScore[startFace] });

	while (open.size > 0) {
		const current = open.pop();
		if (!current) {
			break;
		}
		if (closed[current.faceId]) {
			continue;
		}
		if (current.score > fScore[current.faceId] + EPSILON) {
			continue;
		}
		if (current.faceId === targetFace) {
			return {
				facePath: reconstructPath(cameFrom, startFace, targetFace),
				totalCost: gScore[targetFace],
			};
		}
		closed[current.faceId] = true;
		const node = graph.nodes[current.faceId];
		if (!node) {
			continue;
		}
		for (let i = 0; i < node.neighbors.length; i += 1) {
			const neighbor = node.neighbors[i];
			const neighborNode = graph.nodes[neighbor.neighborFaceId];
			if (!neighborNode || closed[neighbor.neighborFaceId]) {
				continue;
			}
			const tentativeG = gScore[current.faceId] + neighbor.stepCost;
			if (tentativeG + EPSILON >= gScore[neighbor.neighborFaceId]) {
				continue;
			}
			cameFrom[neighbor.neighborFaceId] = current.faceId;
			gScore[neighbor.neighborFaceId] = tentativeG;
			fScore[neighbor.neighborFaceId] =
				tentativeG + heuristic(neighborNode.point, targetNode.point, graph.maxStepDistance);
			open.push({ faceId: neighbor.neighborFaceId, score: fScore[neighbor.neighborFaceId] });
		}
	}

	return { facePath: [], totalCost: Number.POSITIVE_INFINITY };
}

export function facePathToPoints(mesh: NavigationMesh, facePath: number[]): Vec2[] {
	const points: Vec2[] = [];
	for (let i = 0; i < facePath.length; i += 1) {
		const faceId = facePath[i];
		const face = mesh.faces[faceId];
		if (!face) {
			continue;
		}
		points.push({ x: face.point.x, y: face.point.y });
	}
	return points;
}

export function createPolylineAdvanceState(points: Vec2[], speedPxPerSec: number): PolylineAdvanceState {
	if (points.length === 0) {
		return {
			points: [],
			segmentIndex: 0,
			segmentT: 1,
			speedPxPerSec,
			position: { x: 0, y: 0 },
			finished: true,
		};
	}
	const finished = points.length < 2;
	return {
		points,
		segmentIndex: 0,
		segmentT: 0,
		speedPxPerSec,
		position: { x: points[0].x, y: points[0].y },
		finished,
	};
}

export function advanceAlongPolyline(state: PolylineAdvanceState, deltaMs: number): PolylineAdvanceState {
	if (state.finished || state.points.length < 2) {
		const last = state.points[state.points.length - 1] ?? state.position;
		return {
			...state,
			position: { x: last.x, y: last.y },
			finished: true,
		};
	}

	const points = state.points;
	let segmentIndex = clamp(Math.floor(state.segmentIndex), 0, points.length - 2);
	let segmentT = clamp(state.segmentT, 0, 1);
	const speed = Math.max(0, state.speedPxPerSec);
	let remaining = (Math.max(0, deltaMs) * speed) / 1000;
	let position: Vec2 = { x: state.position.x, y: state.position.y };

	while (remaining > EPSILON && segmentIndex < points.length - 1) {
		const a = points[segmentIndex];
		const b = points[segmentIndex + 1];
		const segmentLength = distance(a, b);
		if (segmentLength <= EPSILON) {
			segmentIndex += 1;
			segmentT = 0;
			position = { x: b.x, y: b.y };
			continue;
		}
		const traversed = segmentLength * segmentT;
		const left = segmentLength - traversed;
		if (remaining + EPSILON < left) {
			const nextTraversed = traversed + remaining;
			segmentT = clamp(nextTraversed / segmentLength, 0, 1);
			position = lerpPoint(a, b, segmentT);
			remaining = 0;
			break;
		}
		remaining -= left;
		segmentIndex += 1;
		segmentT = 0;
		position = { x: b.x, y: b.y };
	}

	const finished = segmentIndex >= points.length - 1;
	if (finished) {
		const last = points[points.length - 1];
		return {
			...state,
			segmentIndex: points.length - 1,
			segmentT: 1,
			position: { x: last.x, y: last.y },
			finished: true,
		};
	}

	return {
		...state,
		segmentIndex,
		segmentT,
		position,
		finished: false,
	};
}

function reconstructPath(cameFrom: number[], startFace: number, targetFace: number): number[] {
	const path: number[] = [];
	let current = targetFace;
	path.push(current);
	while (current !== startFace) {
		current = cameFrom[current];
		if (current < 0) {
			return [];
		}
		path.push(current);
	}
	path.reverse();
	return path;
}

function heuristic(a: Vec2, b: Vec2, maxStepDistance: number): number {
	if (maxStepDistance <= EPSILON) {
		return 0;
	}
	return distance(a, b) / maxStepDistance;
}

function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sanitizePathfindingCostParams(params: PathfindingCostParams): PathfindingCostParams {
	const lowlandThreshold = clamp(Math.round(params.lowlandThreshold), 1, 31);
	const impassableThreshold = clamp(Math.round(params.impassableThreshold), 2, 32);
	const adjustedImpassableThreshold = Math.max(lowlandThreshold + 1, impassableThreshold);
	return {
		lowlandThreshold,
		impassableThreshold: clamp(adjustedImpassableThreshold, 2, 32),
		elevationPower: clamp(params.elevationPower, 0.5, 2),
		elevationGainK: clamp(params.elevationGainK, 0, 4),
		riverPenalty: clamp(params.riverPenalty, 0, 8),
	};
}

export function computeElevationFactor(
	elevation: number,
	lowlandThreshold: number,
	impassableThreshold: number,
	elevationPower: number,
	elevationGainK: number
): number | null {
	const safeElevation = Math.round(elevation);
	const safeLowlandThreshold = clamp(Math.round(lowlandThreshold), 1, 31);
	const safeImpassableThreshold = clamp(Math.round(impassableThreshold), 2, 32);
	const adjustedImpassableThreshold = Math.max(safeLowlandThreshold + 1, safeImpassableThreshold);
	const safePower = clamp(elevationPower, 0.5, 2);
	const safeGain = clamp(elevationGainK, 0, 4);
	if (safeElevation >= adjustedImpassableThreshold) {
		return null;
	}
	if (safeElevation <= safeLowlandThreshold) {
		return 1;
	}
	const t = clamp(
		(safeElevation - safeLowlandThreshold) / (adjustedImpassableThreshold - safeLowlandThreshold),
		0,
		1
	);
	return 1 + safeGain * Math.pow(t, safePower);
}

export function computeTerrainStepFactor(
	elevation: number,
	crossedRiver: boolean,
	params: PathfindingCostParams
): number | null {
	const clamped = sanitizePathfindingCostParams(params);
	const elevationFactor = computeElevationFactor(
		elevation,
		clamped.lowlandThreshold,
		clamped.impassableThreshold,
		clamped.elevationPower,
		clamped.elevationGainK
	);
	if (elevationFactor === null) {
		return null;
	}
	const riverFactor = crossedRiver ? 1 + clamped.riverPenalty : 1;
	return elevationFactor * riverFactor;
}

type MinHeapEntry = {
	faceId: number;
	score: number;
};

class MinHeap {
	private entries: MinHeapEntry[] = [];

	get size(): number {
		return this.entries.length;
	}

	push(entry: MinHeapEntry): void {
		this.entries.push(entry);
		this.bubbleUp(this.entries.length - 1);
	}

	pop(): MinHeapEntry | undefined {
		if (this.entries.length === 0) {
			return undefined;
		}
		const top = this.entries[0];
		const last = this.entries.pop();
		if (this.entries.length > 0 && last) {
			this.entries[0] = last;
			this.bubbleDown(0);
		}
		return top;
	}

	private bubbleUp(startIndex: number): void {
		let index = startIndex;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (compareHeapEntries(this.entries[parent], this.entries[index]) <= 0) {
				break;
			}
			[this.entries[parent], this.entries[index]] = [this.entries[index], this.entries[parent]];
			index = parent;
		}
	}

	private bubbleDown(startIndex: number): void {
		let index = startIndex;
		while (true) {
			const left = index * 2 + 1;
			const right = left + 1;
			let smallest = index;
			if (
				left < this.entries.length &&
				compareHeapEntries(this.entries[left], this.entries[smallest]) < 0
			) {
				smallest = left;
			}
			if (
				right < this.entries.length &&
				compareHeapEntries(this.entries[right], this.entries[smallest]) < 0
			) {
				smallest = right;
			}
			if (smallest === index) {
				break;
			}
			[this.entries[smallest], this.entries[index]] = [this.entries[index], this.entries[smallest]];
			index = smallest;
		}
	}
}

function compareHeapEntries(a: MinHeapEntry, b: MinHeapEntry): number {
	if (a.score < b.score) {
		return -1;
	}
	if (a.score > b.score) {
		return 1;
	}
	return a.faceId - b.faceId;
}
