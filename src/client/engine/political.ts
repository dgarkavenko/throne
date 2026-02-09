import { clamp, vec2Len, vec2Sub, type Vec2 } from './throne-math';
import type { RiverNetwork } from './rivers';

type MeshFace = {
	index: number;
	point: Vec2;
	adjacentFaces: number[];
	elevation: number;
};

type MeshEdge = {
	faces: [number, number];
};

type MeshGraph = {
	faces: MeshFace[];
	edges: MeshEdge[];
};

export type PoliticalControls = {
	provinceCount: number;
	spacing: number;
	provinceMountainPassageThreshold: number;
	provinceSingleIslandMaxPercent: number;
};

export type ProvinceFace = {
	// Province index.
	index: number;
	// Indices into mesh.faces that belong to this province.
	faces: number[];
	// Indices into province.outerEdges that surround this province.
	outerEdges: number[];
	// Neighboring province indices (unique, excludes water).
	adjacentProvinces: number[];
	// Neighboring province indices reachable via passable edges.
	connectedProvinces: number[];
};

export type ProvinceOuterEdge = {
	// Index into province.outerEdges.
	index: number;
	// Index into mesh.edges that forms this boundary.
	edge: number;
	// Province ids on either side. Water/outside is -1.
	provinces: [number, number];
	// Face ids on either side. Outside is -1.
	faces: [number, number];
};

export type ProvinceGraph = {
	// Province faces following the mesh graph convention.
	faces: ProvinceFace[];
	// Boundary edges between provinces or province/water.
	outerEdges: ProvinceOuterEdge[];
	// Per mesh face province lookup (-1 for water).
	provinceByFace: number[];
	// Seed faces used for province generation.
	seedFaces: number[];
	// Land face indices.
	landFaces: number[];
	// Land mask by mesh face.
	isLand: boolean[];
};

type ProvinceSeedState = {
	provinceByFace: number[];
	seedFaces: number[];
	landFaces: number[];
	isLand: boolean[];
	provinceCount: number;
};

type ProvinceHeapEntry = {
	score: number;
	dist: number;
	provinceId: number;
	faceId: number;
};

type EdgeKey = `${number}:${number}`;

const MAX_LAND_ELEVATION = 32;

type PassabilityResult = {
	isEdgePassable: (faceA: number, faceB: number) => boolean;
	edgeByFacePair: Map<EdgeKey, number>;
};

type IslandPlan = {
	faces: number[];
	size: number;
	forceSingle: boolean;
	passableComponents: number[][];
	minSeeds: number;
	seedCount: number;
};

export function basegenPolitical(
	mesh: MeshGraph,
	controls: PoliticalControls,
	random: () => number,
	riverNetwork?: RiverNetwork
): ProvinceGraph {
	const faceCount = mesh.faces.length;
	const provinceByFace = new Array<number>(faceCount).fill(-1);
	if (faceCount === 0) {
		return {
			faces: [],
			outerEdges: [],
			provinceByFace,
			seedFaces: [],
			landFaces: [],
			isLand: [],
		};
	}

	const landFaces: number[] = [];
	const isLand = new Array<boolean>(faceCount).fill(false);
	mesh.faces.forEach((face) => {
		if (face.elevation >= 1) {
			isLand[face.index] = true;
			landFaces.push(face.index);
		}
	});

	if (landFaces.length === 0) {
		return {
			faces: [],
			outerEdges: [],
			provinceByFace,
			seedFaces: [],
			landFaces,
			isLand,
		};
	}

	const components = getLandComponents(mesh, isLand);
	const totalLandFaces = landFaces.length;
	const passability = buildPassability(mesh, controls, isLand, riverNetwork);
	const maxIslandPercent = clamp(controls.provinceSingleIslandMaxPercent ?? 10, 0, 25);

	const islandPlans: IslandPlan[] = [];
	for (let i = 0; i < components.length; i += 1) {
		const faces = components[i].slice();
		const size = faces.length;
		const islandPercent = (size / totalLandFaces) * 100;
		const forceSingle = islandPercent <= maxIslandPercent;
		const passableComponents = forceSingle
			? [faces.slice()]
			: getPassableComponents(mesh, faces, passability.isEdgePassable);
		const minSeeds = forceSingle ? 1 : passableComponents.length;
		islandPlans.push({
			faces,
			size,
			forceSingle,
			passableComponents,
			minSeeds,
			seedCount: minSeeds,
		});
	}

	const provinceTarget = clamp(Math.round(controls.provinceCount || 1), 1, landFaces.length);
	const totalMinSeeds = islandPlans.reduce((sum, plan) => sum + plan.minSeeds, 0);
	const finalTarget = totalMinSeeds > provinceTarget ? totalMinSeeds : provinceTarget;
	const extraSeeds = finalTarget - totalMinSeeds;
	if (extraSeeds > 0) {
		allocateExtraSeeds(islandPlans, extraSeeds);
	}

	const seedFaces: number[] = [];
	let provinceOffset = 0;
	for (let i = 0; i < islandPlans.length; i += 1) {
		const plan = islandPlans[i];
		if (plan.seedCount <= 0) {
			continue;
		}
		const baseSeeds: number[] = [];
		if (plan.forceSingle) {
			baseSeeds.push(...pickFarthestSeeds(plan.faces, mesh, 1, random));
		} else {
			for (let j = 0; j < plan.passableComponents.length; j += 1) {
				const componentFaces = plan.passableComponents[j];
				baseSeeds.push(...pickFarthestSeeds(componentFaces, mesh, 1, random));
			}
		}
		const extra = Math.max(0, plan.seedCount - baseSeeds.length);
		const seeds = pickAdditionalSeeds(plan.faces, mesh, baseSeeds, extra);
		const planIsLand = new Array<boolean>(faceCount).fill(false);
		for (let j = 0; j < plan.faces.length; j += 1) {
			planIsLand[plan.faces[j]] = true;
		}
		const isEdgePassable = plan.forceSingle ? undefined : passability.isEdgePassable;
		const assignment = growProvinceRegions(
			mesh,
			planIsLand,
			plan.faces,
			seeds,
			controls.spacing,
			isEdgePassable
		);
		const localProvinceCount = assignment.provinceCount;
		for (let j = 0; j < plan.faces.length; j += 1) {
			const faceIndex = plan.faces[j];
			const localProvince = assignment.provinceByFace[faceIndex];
			if (localProvince >= 0) {
				provinceByFace[faceIndex] = localProvince + provinceOffset;
			}
		}
		for (let j = 0; j < assignment.seedFaces.length; j += 1) {
			seedFaces.push(assignment.seedFaces[j]);
		}
		provinceOffset += localProvinceCount;
	}

	const provinceGraph = buildProvinceGraph(mesh, provinceByFace, landFaces, isLand, passability);
	return {
		...provinceGraph,
		provinceByFace,
		seedFaces,
		landFaces,
		isLand,
	};
}

function getLandComponents(mesh: MeshGraph, isLand: boolean[]): number[][] {
	const visited = new Array<boolean>(mesh.faces.length).fill(false);
	const components: number[][] = [];
	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (!isLand[i] || visited[i]) {
			continue;
		}
		const stack = [i];
		const component: number[] = [];
		visited[i] = true;
		while (stack.length > 0) {
			const faceIndex = stack.pop() as number;
			component.push(faceIndex);
			const face = mesh.faces[faceIndex];
			for (let j = 0; j < face.adjacentFaces.length; j += 1) {
				const neighbor = face.adjacentFaces[j];
				if (!isLand[neighbor] || visited[neighbor]) {
					continue;
				}
				visited[neighbor] = true;
				stack.push(neighbor);
			}
		}
		components.push(component);
	}
	return components;
}

function pickFarthestSeeds(
	componentFaces: number[],
	mesh: MeshGraph,
	seedCount: number,
	random: () => number
): number[] {
	if (seedCount <= 0 || componentFaces.length === 0) {
		return [];
	}
	const seeds: number[] = [];
	const first = componentFaces[Math.floor(random() * componentFaces.length)];
	seeds.push(first);
	while (seeds.length < seedCount && seeds.length < componentFaces.length) {
		let bestFace = componentFaces[0];
		let bestDist = -1;
		for (let i = 0; i < componentFaces.length; i += 1) {
			const faceIndex = componentFaces[i];
			let minDist = Number.POSITIVE_INFINITY;
			const point = mesh.faces[faceIndex].point;
			for (let s = 0; s < seeds.length; s += 1) {
				const seedPoint = mesh.faces[seeds[s]].point;
				const dist = vec2Len(vec2Sub(point, seedPoint));
				if (dist < minDist) {
					minDist = dist;
				}
			}
			if (minDist > bestDist) {
				bestDist = minDist;
				bestFace = faceIndex;
			}
		}
		seeds.push(bestFace);
	}
	return seeds;
}

function pickAdditionalSeeds(
	componentFaces: number[],
	mesh: MeshGraph,
	baseSeeds: number[],
	extraCount: number
): number[] {
	const seeds = baseSeeds.slice();
	if (extraCount <= 0 || componentFaces.length === 0) {
		return seeds;
	}
	while (seeds.length < baseSeeds.length + extraCount && seeds.length < componentFaces.length) {
		let bestFace = componentFaces[0];
		let bestDist = -1;
		for (let i = 0; i < componentFaces.length; i += 1) {
			const faceIndex = componentFaces[i];
			if (seeds.includes(faceIndex)) {
				continue;
			}
			let minDist = Number.POSITIVE_INFINITY;
			const point = mesh.faces[faceIndex].point;
			for (let s = 0; s < seeds.length; s += 1) {
				const seedPoint = mesh.faces[seeds[s]].point;
				const dist = vec2Len(vec2Sub(point, seedPoint));
				if (dist < minDist) {
					minDist = dist;
				}
			}
			if (minDist > bestDist) {
				bestDist = minDist;
				bestFace = faceIndex;
			}
		}
		if (!seeds.includes(bestFace)) {
			seeds.push(bestFace);
		} else {
			break;
		}
	}
	return seeds;
}

function buildProvinceGraph(
	mesh: MeshGraph,
	provinceByFace: number[],
	landFaces: number[],
	isLand: boolean[],
	passability: PassabilityResult
): { faces: ProvinceFace[]; outerEdges: ProvinceOuterEdge[] } {
	let provinceCount = 0;
	for (let i = 0; i < landFaces.length; i += 1) {
		const provinceId = provinceByFace[landFaces[i]];
		if (provinceId >= provinceCount) {
			provinceCount = provinceId + 1;
		}
	}

	const faces: ProvinceFace[] = new Array(provinceCount);
	for (let i = 0; i < provinceCount; i += 1) {
		faces[i] = {
			index: i,
			faces: [],
			outerEdges: [],
			adjacentProvinces: [],
			connectedProvinces: [],
		};
	}

	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		const provinceId = provinceByFace[faceIndex];
		if (provinceId >= 0) {
			faces[provinceId].faces.push(faceIndex);
		}
	}

	const outerEdges: ProvinceOuterEdge[] = [];
	const addAdjacent = (a: number, b: number): void => {
		if (a < 0 || b < 0) {
			return;
		}
		if (!faces[a].adjacentProvinces.includes(b)) {
			faces[a].adjacentProvinces.push(b);
		}
	};
	const addConnected = (a: number, b: number): void => {
		if (a < 0 || b < 0) {
			return;
		}
		if (!faces[a].connectedProvinces.includes(b)) {
			faces[a].connectedProvinces.push(b);
		}
	};

	const registerOuterEdge = (
		edgeIndex: number,
		provinceA: number,
		provinceB: number,
		faceA: number,
		faceB: number
	): void => {
		const index = outerEdges.length;
		outerEdges.push({
			index,
			edge: edgeIndex,
			provinces: [provinceA, provinceB],
			faces: [faceA, faceB],
		});
		if (provinceA >= 0) {
			faces[provinceA].outerEdges.push(index);
			addAdjacent(provinceA, provinceB);
			if (provinceB >= 0 && passability.isEdgePassable(faceA, faceB)) {
				addConnected(provinceA, provinceB);
			}
		}
		if (provinceB >= 0) {
			faces[provinceB].outerEdges.push(index);
			addAdjacent(provinceB, provinceA);
			if (provinceA >= 0 && passability.isEdgePassable(faceB, faceA)) {
				addConnected(provinceB, provinceA);
			}
		}
	};

	for (let e = 0; e < mesh.edges.length; e += 1) {
		const edge = mesh.edges[e];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			const landFace = faceA >= 0 && isLand[faceA] ? faceA : faceB >= 0 && isLand[faceB] ? faceB : -1;
			if (landFace >= 0) {
				registerOuterEdge(e, provinceByFace[landFace], -1, faceA, faceB);
			}
			continue;
		}

		const landA = isLand[faceA];
		const landB = isLand[faceB];
		if (landA && landB) {
			const provinceA = provinceByFace[faceA];
			const provinceB = provinceByFace[faceB];
			if (provinceA >= 0 && provinceB >= 0 && provinceA !== provinceB) {
				registerOuterEdge(e, provinceA, provinceB, faceA, faceB);
			}
			continue;
		}
		if (landA !== landB) {
			const landFace = landA ? faceA : faceB;
			const provinceId = provinceByFace[landFace];
			if (provinceId >= 0) {
				registerOuterEdge(e, provinceId, -1, faceA, faceB);
			}
		}
	}

	return { faces, outerEdges };
}

class ProvinceMinHeap {
	private items: ProvinceHeapEntry[] = [];

	push(entry: ProvinceHeapEntry): void {
		this.items.push(entry);
		this.bubbleUp(this.items.length - 1);
	}

	pop(): ProvinceHeapEntry | undefined {
		if (this.items.length === 0) {
			return undefined;
		}
		const top = this.items[0];
		const last = this.items.pop();
		if (this.items.length > 0 && last) {
			this.items[0] = last;
			this.bubbleDown(0);
		}
		return top;
	}

	get size(): number {
		return this.items.length;
	}

	private bubbleUp(index: number): void {
		let idx = index;
		while (idx > 0) {
			const parent = Math.floor((idx - 1) / 2);
			if (this.items[parent].score <= this.items[idx].score) {
				break;
			}
			[this.items[parent], this.items[idx]] = [this.items[idx], this.items[parent]];
			idx = parent;
		}
	}

	private bubbleDown(index: number): void {
		let idx = index;
		while (true) {
			const left = idx * 2 + 1;
			const right = left + 1;
			let smallest = idx;
			if (left < this.items.length && this.items[left].score < this.items[smallest].score) {
				smallest = left;
			}
			if (right < this.items.length && this.items[right].score < this.items[smallest].score) {
				smallest = right;
			}
			if (smallest === idx) {
				break;
			}
			[this.items[smallest], this.items[idx]] = [this.items[idx], this.items[smallest]];
			idx = smallest;
		}
	}
}

function growProvinceRegions(
	mesh: MeshGraph,
	isLand: boolean[],
	landFaces: number[],
	seedFaces: number[],
	spacing: number,
	isEdgePassable?: (faceA: number, faceB: number) => boolean
): ProvinceSeedState {
	const faceCount = mesh.faces.length;
	const provinceByFace = new Array<number>(faceCount).fill(-1);
	const seedPoints = seedFaces.map((faceIndex) => mesh.faces[faceIndex].point);
	const actualProvinceCount = Math.min(seedFaces.length, landFaces.length);
	const provinceSizes = new Array<number>(actualProvinceCount).fill(0);
	const targetSize = Math.max(1, Math.floor(landFaces.length / Math.max(1, actualProvinceCount)));
	const balanceWeight = Math.max(8, spacing * 1.1);

	const heap = new ProvinceMinHeap();
	for (let i = 0; i < actualProvinceCount; i += 1) {
		const seedFace = seedFaces[i];
		provinceByFace[seedFace] = i;
		provinceSizes[i] = 1;
		const face = mesh.faces[seedFace];
		for (let j = 0; j < face.adjacentFaces.length; j += 1) {
			const neighbor = face.adjacentFaces[j];
			if (isEdgePassable && !isEdgePassable(seedFace, neighbor)) {
				continue;
			}
			if (!isLand[neighbor] || provinceByFace[neighbor] >= 0) {
				continue;
			}
			const dist = vec2Len(vec2Sub(mesh.faces[neighbor].point, seedPoints[i]));
			const score = dist + balanceWeight * (provinceSizes[i] / targetSize);
			heap.push({ score, dist, provinceId: i, faceId: neighbor });
		}
	}

	while (heap.size > 0) {
		const entry = heap.pop();
		if (!entry) {
			break;
		}
		if (provinceByFace[entry.faceId] >= 0 || !isLand[entry.faceId]) {
			continue;
		}
		provinceByFace[entry.faceId] = entry.provinceId;
		provinceSizes[entry.provinceId] += 1;
		const face = mesh.faces[entry.faceId];
		for (let j = 0; j < face.adjacentFaces.length; j += 1) {
			const neighbor = face.adjacentFaces[j];
			if (isEdgePassable && !isEdgePassable(entry.faceId, neighbor)) {
				continue;
			}
			if (!isLand[neighbor] || provinceByFace[neighbor] >= 0) {
				continue;
			}
			const dist = vec2Len(vec2Sub(mesh.faces[neighbor].point, seedPoints[entry.provinceId]));
			const score = dist + balanceWeight * (provinceSizes[entry.provinceId] / targetSize);
			heap.push({ score, dist, provinceId: entry.provinceId, faceId: neighbor });
		}
	}

	const fallbackSeeds: number[] = [];
	let provinceCount = actualProvinceCount;
	const unassigned = landFaces.filter((faceIndex) => provinceByFace[faceIndex] < 0);
	if (unassigned.length > 0) {
		const components = getPassableComponents(
			mesh,
			unassigned,
			(a, b) => {
				if (!isEdgePassable) {
					return true;
				}
				return isEdgePassable(a, b);
			},
			new Set(unassigned)
		);
		for (let i = 0; i < components.length; i += 1) {
			const component = components[i];
			if (component.length === 0) {
				continue;
			}
			const seedFace = component[0];
			const newProvinceId = provinceCount;
			provinceCount += 1;
			fallbackSeeds.push(seedFace);
			const queue = [seedFace];
			provinceByFace[seedFace] = newProvinceId;
			while (queue.length > 0) {
				const current = queue.pop() as number;
				const currentFace = mesh.faces[current];
				for (let j = 0; j < currentFace.adjacentFaces.length; j += 1) {
					const neighbor = currentFace.adjacentFaces[j];
					if (!isLand[neighbor] || provinceByFace[neighbor] >= 0) {
						continue;
					}
					if (isEdgePassable && !isEdgePassable(current, neighbor)) {
						continue;
					}
					provinceByFace[neighbor] = newProvinceId;
					queue.push(neighbor);
				}
			}
		}
	}

	return {
		provinceByFace,
		seedFaces: seedFaces.concat(fallbackSeeds),
		landFaces,
		isLand,
		provinceCount,
	};
}

function buildPassability(
	mesh: MeshGraph,
	controls: PoliticalControls,
	isLand: boolean[],
	riverNetwork?: RiverNetwork
): PassabilityResult {
	const edgeByFacePair = new Map<EdgeKey, number>();
	for (let e = 0; e < mesh.edges.length; e += 1) {
		const edge = mesh.edges[e];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		const key: EdgeKey = faceA < faceB ? `${faceA}:${faceB}` : `${faceB}:${faceA}`;
		edgeByFacePair.set(key, e);
	}
	const threshold = clamp(controls.provinceMountainPassageThreshold ?? 0.65, 0, 1);
	const barrierEdgeSet = riverNetwork?.barrierEdgeSet ?? new Set<number>();
	const isEdgePassable = (faceA: number, faceB: number): boolean => {
		if (!isLand[faceA] || !isLand[faceB]) {
			return false;
		}
		const key: EdgeKey = faceA < faceB ? `${faceA}:${faceB}` : `${faceB}:${faceA}`;
		const edgeIndex = edgeByFacePair.get(key);
		if (edgeIndex === undefined) {
			return false;
		}
		if (barrierEdgeSet.has(edgeIndex)) {
			return false;
		}
		const elevA = mesh.faces[faceA].elevation;
		const elevB = mesh.faces[faceB].elevation;
		const mountainScore = Math.min(elevA, elevB) / MAX_LAND_ELEVATION;
		if (mountainScore >= threshold) {
			return false;
		}
		return true;
	};
	return { isEdgePassable, edgeByFacePair };
}

function getPassableComponents(
	mesh: MeshGraph,
	faces: number[],
	isEdgePassable: (faceA: number, faceB: number) => boolean,
	allowedSet?: Set<number>
): number[][] {
	const set = allowedSet ?? new Set<number>(faces);
	const visited = new Set<number>();
	const components: number[][] = [];
	for (let i = 0; i < faces.length; i += 1) {
		const start = faces[i];
		if (!set.has(start) || visited.has(start)) {
			continue;
		}
		const stack = [start];
		const component: number[] = [];
		visited.add(start);
		while (stack.length > 0) {
			const current = stack.pop() as number;
			component.push(current);
			const face = mesh.faces[current];
			for (let j = 0; j < face.adjacentFaces.length; j += 1) {
				const neighbor = face.adjacentFaces[j];
				if (!set.has(neighbor) || visited.has(neighbor)) {
					continue;
				}
				if (!isEdgePassable(current, neighbor)) {
					continue;
				}
				visited.add(neighbor);
				stack.push(neighbor);
			}
		}
		components.push(component);
	}
	return components;
}

function allocateExtraSeeds(plans: IslandPlan[], totalExtras: number): void {
	if (totalExtras <= 0) {
		return;
	}
	const candidates = plans.map((plan) => ({
		plan,
		capacity: plan.forceSingle ? 0 : Math.max(0, plan.size - plan.minSeeds),
	}));
	let remaining = totalExtras;
	const totalSize = candidates.reduce((sum, entry) => sum + (entry.capacity > 0 ? entry.plan.size : 0), 0);
	if (totalSize > 0) {
		for (let i = 0; i < candidates.length; i += 1) {
			const entry = candidates[i];
			if (entry.capacity <= 0) {
				continue;
			}
			const exact = (entry.plan.size / totalSize) * remaining;
			const extra = Math.min(entry.capacity, Math.floor(exact));
			if (extra > 0) {
				entry.plan.seedCount += extra;
				entry.capacity -= extra;
				remaining -= extra;
			}
		}
	}
	if (remaining > 0) {
		const sorted = candidates
			.filter((entry) => entry.capacity > 0)
			.sort((a, b) => b.plan.size - a.plan.size);
		let idx = 0;
		while (remaining > 0 && sorted.length > 0) {
			const entry = sorted[idx % sorted.length];
			if (entry.capacity <= 0) {
				idx += 1;
				continue;
			}
			entry.plan.seedCount += 1;
			entry.capacity -= 1;
			remaining -= 1;
			idx += 1;
		}
	}
}
