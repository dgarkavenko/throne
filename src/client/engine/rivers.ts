import { clamp, vec2Len, vec2Sub, type Vec2 } from './throne-math';
import type { TerrainControls } from './terrain';

type MeshFace = {
	index: number;
	elevation: number;
	adjacentFaces: number[];
};

type MeshVertex = {
	index: number;
	point: Vec2;
	faces: number[];
	edges: number[];
};

type MeshEdge = {
	index: number;
	faces: [number, number];
	vertices: [number, number];
};

type MeshGraph = {
	faces: MeshFace[];
	vertices: MeshVertex[];
	edges: MeshEdge[];
};

type RiverCandidate = {
	edgeIndex: number;
	nextVertex: number;
	nextFace: number;
	nextElevation: number;
};

export type RiverTrace = {
	edges: number[];
	vertices: number[];
	faces: number[];
	length: number;
	depth: number;
};

export type RiverNetwork = {
	traces: RiverTrace[];
	barrierEdgeSet: Set<number>;
};

export function buildRiverNetwork(
	mesh: MeshGraph,
	controls: TerrainControls,
	random: () => number
): RiverNetwork {
	const riverDensity = clamp(controls.riverDensity ?? 0, 0, 2);
	const riverBranchChance = clamp(controls.riverBranchChance ?? 0.25, 0, 1);
	if (riverDensity <= 0) {
		return { traces: [], barrierEdgeSet: new Set() };
	}

	const vertexHasLand = new Array<boolean>(mesh.vertices.length).fill(false);
	const vertexHasWater = new Array<boolean>(mesh.vertices.length).fill(false);
	mesh.vertices.forEach((vertex) => {
		let hasLand = false;
		let hasWater = false;
		for (let i = 0; i < vertex.faces.length; i += 1) {
			const face = mesh.faces[vertex.faces[i]];
			if (face.elevation >= 1) {
				hasLand = true;
			} else {
				hasWater = true;
			}
		}
		vertexHasLand[vertex.index] = hasLand;
		vertexHasWater[vertex.index] = hasWater;
	});

	const shorelineVertices: number[] = [];
	for (let i = 0; i < mesh.vertices.length; i += 1) {
		if (vertexHasLand[i] && vertexHasWater[i]) {
			shorelineVertices.push(i);
		}
	}
	if (shorelineVertices.length === 0) {
		return { traces: [], barrierEdgeSet: new Set() };
	}

	const baseCount = Math.max(1, Math.round(shorelineVertices.length / 60));
	const desiredCount = Math.round(baseCount * riverDensity);
	if (desiredCount <= 0) {
		return { traces: [], barrierEdgeSet: new Set() };
	}

	const mouthCandidates: Array<{ vertex: number; startFace: number }> = [];
	for (let i = 0; i < shorelineVertices.length; i += 1) {
		const vertexIndex = shorelineVertices[i];
		const startFace = pickStartFaceForMouth(mesh, vertexIndex, random);
		if (startFace < 0) {
			continue;
		}
		if (!hasValidRiverStart(mesh, vertexIndex, startFace)) {
			continue;
		}
		mouthCandidates.push({ vertex: vertexIndex, startFace });
	}
	if (mouthCandidates.length === 0) {
		return { traces: [], barrierEdgeSet: new Set() };
	}

	const mouths = pickRiverMouthsWithFaces(mouthCandidates, desiredCount, random);
	const usedEdges = new Set<number>();
	const maxSteps = clamp(Math.round(mesh.vertices.length * 0.15), 40, 260);
	const traces: RiverTrace[] = [];

	for (let i = 0; i < mouths.length; i += 1) {
		const mouth = mouths[i];
		const visitedFaces = new Set<number>([mouth.startFace]);
		const riverTraces = growRiverTrace(
			mesh,
			usedEdges,
			random,
			mouth.vertex,
			mouth.startFace,
			maxSteps,
			0,
			0,
			riverBranchChance,
			visitedFaces
		);
		for (let j = 0; j < riverTraces.length; j += 1) {
			if (riverTraces[j].edges.length > 0) {
				traces.push(riverTraces[j]);
			}
		}
	}

	const barrierEdgeSet = new Set<number>();
	for (let i = 0; i < traces.length; i += 1) {
		for (let j = 0; j < traces[i].edges.length; j += 1) {
			barrierEdgeSet.add(traces[i].edges[j]);
		}
	}

	return { traces, barrierEdgeSet };
}

function isFaceShoreline(mesh: MeshGraph, faceIndex: number): boolean {
	const face = mesh.faces[faceIndex];
	for (let i = 0; i < face.adjacentFaces.length; i += 1) {
		const neighbor = face.adjacentFaces[i];
		if (mesh.faces[neighbor].elevation <= 0) {
			return true;
		}
	}
	return false;
}

function pickStartFaceForMouth(mesh: MeshGraph, vertexIndex: number, random: () => number): number {
	const vertex = mesh.vertices[vertexIndex];
	const shorelineFaces = vertex.faces.filter(
		(faceIndex) => mesh.faces[faceIndex].elevation >= 1 && isFaceShoreline(mesh, faceIndex)
	);
	if (shorelineFaces.length === 0) {
		return -1;
	}
	let minElevation = Number.POSITIVE_INFINITY;
	for (let i = 0; i < shorelineFaces.length; i += 1) {
		minElevation = Math.min(minElevation, mesh.faces[shorelineFaces[i]].elevation);
	}
	const lowest = shorelineFaces.filter(
		(faceIndex) => mesh.faces[faceIndex].elevation === minElevation
	);
	return lowest[Math.floor(random() * lowest.length)] ?? -1;
}

function hasValidRiverStart(mesh: MeshGraph, vertexIndex: number, startFace: number): boolean {
	const currentElevation = mesh.faces[startFace].elevation;
	const vertex = mesh.vertices[vertexIndex];
	for (let i = 0; i < vertex.edges.length; i += 1) {
		const edgeIndex = vertex.edges[i];
		const edge = mesh.edges[edgeIndex];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		if (mesh.faces[faceA].elevation < 1 || mesh.faces[faceB].elevation < 1) {
			continue;
		}
		let nextFace: number | null = null;
		if (faceA === startFace || faceB === startFace) {
			nextFace = faceA === startFace ? faceB : faceA;
		} else {
			const elevA = mesh.faces[faceA].elevation;
			const elevB = mesh.faces[faceB].elevation;
			if (elevA >= currentElevation || elevB >= currentElevation) {
				nextFace = elevA >= elevB ? faceA : faceB;
			}
		}
		if (nextFace === null) {
			continue;
		}
		if (mesh.faces[nextFace].elevation < currentElevation) {
			continue;
		}
		return true;
	}
	return false;
}

function pickRiverMouthsWithFaces(
	candidates: Array<{ vertex: number; startFace: number }>,
	desiredCount: number,
	random: () => number
): Array<{ vertex: number; startFace: number }> {
	const pool = candidates.slice();
	const count = Math.min(desiredCount, pool.length);
	const mouths: Array<{ vertex: number; startFace: number }> = [];
	for (let i = 0; i < count; i += 1) {
		const idx = Math.floor(random() * pool.length);
		const pick = pool[idx];
		mouths.push(pick);
		pool[idx] = pool[pool.length - 1];
		pool.pop();
		if (pool.length === 0) {
			break;
		}
	}
	return mouths;
}

function growRiverTrace(
	mesh: MeshGraph,
	usedEdges: Set<number>,
	random: () => number,
	startVertex: number,
	startFace: number,
	maxSteps: number,
	depth: number,
	initialFlatSteps: number,
	branchChance: number,
	visitedFaces: Set<number>
): RiverTrace[] {
	const traces: RiverTrace[] = [];
	const vertices: number[] = [startVertex];
	const edges: number[] = [];
	const faces: number[] = [startFace];
	let length = 0;
	let currentVertex = startVertex;
	let currentFace = startFace;
	let currentElevation = mesh.faces[currentFace].elevation;
	if (currentElevation < 1) {
		return traces;
	}
	let flatSteps = initialFlatSteps;
	let steps = 0;

	while (steps < maxSteps) {
		const candidates = collectRiverCandidates(
			mesh,
			usedEdges,
			visitedFaces,
			currentVertex,
			currentFace,
			currentElevation,
			flatSteps
		);
		if (candidates.length === 0) {
			break;
		}
		let remaining = candidates.slice();
		let main: RiverCandidate | null = null;
		let branch: RiverCandidate | null = null;
		while (remaining.length > 0 && !main) {
			const selection = chooseRiverEdges(remaining, random, depth, branchChance);
			main = selection.main;
			branch = selection.branch;
		}
		if (!main) {
			break;
		}

		if (branch) {
			usedEdges.add(branch.edgeIndex);
			const nextFlatSteps = branch.nextElevation === currentElevation ? flatSteps + 1 : 0;
			const branchVisited = new Set<number>(visitedFaces);
			branchVisited.add(branch.nextFace);
			const branchPaths = growRiverTrace(
				mesh,
				usedEdges,
				random,
				branch.nextVertex,
				branch.nextFace,
				Math.max(0, maxSteps - steps - 1),
				depth + 1,
				nextFlatSteps,
				branchChance,
				branchVisited
			);
			const branchSegment = createSegmentTrace(mesh, currentVertex, currentFace, branch, depth + 1);
			if (branchPaths.length === 0) {
				traces.push(branchSegment);
			} else {
				for (let i = 0; i < branchPaths.length; i += 1) {
					const merged = concatTracesIfConnected(branchSegment, branchPaths[i]);
					if (merged) {
						traces.push(merged);
					}
				}
			}
		}

		usedEdges.add(main.edgeIndex);
		edges.push(main.edgeIndex);
		vertices.push(main.nextVertex);
		faces.push(main.nextFace);
		length += computeSegmentLength(mesh, currentVertex, main.nextVertex);
		const nextElevation = main.nextElevation;
		flatSteps = nextElevation === currentElevation ? flatSteps + 1 : 0;
		currentVertex = main.nextVertex;
		currentFace = main.nextFace;
		currentElevation = nextElevation;
		visitedFaces.add(currentFace);
		steps += 1;
	}

	if (edges.length > 0) {
		traces.push({ edges, vertices, faces, length, depth });
	}
	return traces;
}

function collectRiverCandidates(
	mesh: MeshGraph,
	usedEdges: Set<number>,
	visitedFaces: Set<number>,
	currentVertex: number,
	currentFace: number,
	currentElevation: number,
	flatSteps: number
): RiverCandidate[] {
	const candidates: RiverCandidate[] = [];
	const vertex = mesh.vertices[currentVertex];
	for (let i = 0; i < vertex.edges.length; i += 1) {
		const edgeIndex = vertex.edges[i];
		if (usedEdges.has(edgeIndex)) {
			continue;
		}
		const edge = mesh.edges[edgeIndex];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		if (mesh.faces[faceA].elevation < 1 || mesh.faces[faceB].elevation < 1) {
			continue;
		}
		const nextVertex = edge.vertices[0] === currentVertex ? edge.vertices[1] : edge.vertices[0];
		let nextFace: number | null = null;
		if (faceA === currentFace || faceB === currentFace) {
			nextFace = faceA === currentFace ? faceB : faceA;
		} else {
			const elevA = mesh.faces[faceA].elevation;
			const elevB = mesh.faces[faceB].elevation;
			if (elevA >= currentElevation || elevB >= currentElevation) {
				nextFace = elevA >= elevB ? faceA : faceB;
			}
		}
		if (nextFace === null) {
			continue;
		}
		if (visitedFaces.has(nextFace)) {
			continue;
		}
		const nextElevation = mesh.faces[nextFace].elevation;
		if (nextElevation < currentElevation) {
			continue;
		}
		if (nextElevation === currentElevation && flatSteps >= 3) {
			continue;
		}
		candidates.push({ edgeIndex, nextVertex, nextFace, nextElevation });
	}
	return candidates;
}

function chooseRiverEdges(
	candidates: RiverCandidate[],
	random: () => number,
	depth: number,
	branchChance: number
): { main: RiverCandidate; branch: RiverCandidate | null } {
	let bestElevation = -Infinity;
	for (let i = 0; i < candidates.length; i += 1) {
		bestElevation = Math.max(bestElevation, candidates[i].nextElevation);
	}
	const bestCandidates = candidates.filter((candidate) => candidate.nextElevation === bestElevation);
	const main = bestCandidates[Math.floor(random() * bestCandidates.length)];

	const remaining = candidates.filter((candidate) => candidate !== main);
	let branch: RiverCandidate | null = null;
	if (remaining.length > 0 && depth < 2 && random() < branchChance) {
		let altElevation = -Infinity;
		for (let i = 0; i < remaining.length; i += 1) {
			altElevation = Math.max(altElevation, remaining[i].nextElevation);
		}
		const altCandidates = remaining.filter((candidate) => candidate.nextElevation === altElevation);
		branch = altCandidates[Math.floor(random() * altCandidates.length)];
	}

	return { main, branch };
}

function computeSegmentLength(mesh: MeshGraph, fromVertex: number, toVertex: number): number {
	const start = mesh.vertices[fromVertex].point;
	const end = mesh.vertices[toVertex].point;
	return vec2Len(vec2Sub(end, start));
}

function createSegmentTrace(
	mesh: MeshGraph,
	startVertex: number,
	startFace: number,
	candidate: RiverCandidate,
	depth: number
): RiverTrace {
	return {
		edges: [candidate.edgeIndex],
		vertices: [startVertex, candidate.nextVertex],
		faces: [startFace, candidate.nextFace],
		length: computeSegmentLength(mesh, startVertex, candidate.nextVertex),
		depth,
	};
}

function concatTracesIfConnected(prefix: RiverTrace, suffix: RiverTrace): RiverTrace | null {
	if (prefix.vertices.length === 0) {
		return suffix;
	}
	if (suffix.vertices.length === 0) {
		return prefix;
	}
	if (prefix.vertices[prefix.vertices.length - 1] !== suffix.vertices[0]) {
		return null;
	}
	return {
		edges: [...prefix.edges, ...suffix.edges],
		vertices: [...prefix.vertices, ...suffix.vertices.slice(1)],
		faces: [...prefix.faces, ...suffix.faces.slice(1)],
		length: prefix.length + suffix.length,
		depth: suffix.depth,
	};
}
