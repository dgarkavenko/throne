import { clamp, vec2Len, vec2LenSq, vec2Sub, type Vec2 } from './throne-math';

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
};

type ProvinceHeapEntry = {
	score: number;
	dist: number;
	provinceId: number;
	faceId: number;
};


export function basegenPolitical(
	mesh: MeshGraph,
	controls: PoliticalControls,
	random: () => number,
	isLandOverride?: boolean[]
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
	const isLand =
		isLandOverride && isLandOverride.length === faceCount
			? isLandOverride.slice()
			: new Array<boolean>(faceCount).fill(false);
	if (!isLandOverride || isLandOverride.length !== faceCount) {
		mesh.faces.forEach((face) => {
			if (face.elevation >= 1) {
				isLand[face.index] = true;
				landFaces.push(face.index);
			}
		});
	} else {
		for (let i = 0; i < isLand.length; i += 1) {
			if (isLand[i]) {
				landFaces.push(i);
			}
		}
	}

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
	const componentStats = getComponentStats(mesh, components);
	const standardSize = Math.max(1, landFaces.length / components.length);
	const tinyThreshold = standardSize / 3;
	const archipelagoThreshold = standardSize * 0.5;
	const archipelagoRadius = controls.spacing * 3;
	const tinyComponentIds: number[] = [];
	const majorComponentIds: number[] = [];

	for (let i = 0; i < components.length; i += 1) {
		if (componentStats.sizes[i] <= tinyThreshold) {
			tinyComponentIds.push(i);
		} else {
			majorComponentIds.push(i);
		}
	}

	const tinyGroups = buildTinyComponentGroups(tinyComponentIds, componentStats.centers, archipelagoRadius);
	const eligibleTinyGroups: number[][] = [];
	const ineligibleTinyComponentIds: number[] = [];
	for (let i = 0; i < tinyGroups.length; i += 1) {
		const group = tinyGroups[i];
		let groupSize = 0;
		for (let j = 0; j < group.length; j += 1) {
			groupSize += componentStats.sizes[group[j]];
		}
		if (groupSize >= archipelagoThreshold) {
			eligibleTinyGroups.push(group);
		} else {
			ineligibleTinyComponentIds.push(...group);
		}
	}

	const provinceGroups: { faces: number[]; size: number }[] = [];
	for (let i = 0; i < majorComponentIds.length; i += 1) {
		const componentId = majorComponentIds[i];
		provinceGroups.push({
			faces: components[componentId].slice(),
			size: componentStats.sizes[componentId],
		});
	}
	for (let i = 0; i < eligibleTinyGroups.length; i += 1) {
		const group = eligibleTinyGroups[i];
		const faces: number[] = [];
		let groupSize = 0;
		for (let j = 0; j < group.length; j += 1) {
			const componentId = group[j];
			faces.push(...components[componentId]);
			groupSize += componentStats.sizes[componentId];
		}
		provinceGroups.push({ faces, size: groupSize });
	}

	let annexFaces: number[] = [];
	for (let i = 0; i < ineligibleTinyComponentIds.length; i += 1) {
		annexFaces.push(...components[ineligibleTinyComponentIds[i]]);
	}

	if (provinceGroups.length === 0) {
		const allFaces: number[] = [];
		components.forEach((component) => allFaces.push(...component));
		provinceGroups.push({ faces: allFaces, size: allFaces.length });
		annexFaces = [];
	}

	const provinceCount = clamp(Math.round(controls.provinceCount || 1), 1, landFaces.length);
	const groupSizes = provinceGroups.map((group) => group.size);
	const capacity = groupSizes.reduce((sum, value) => sum + value, 0);
	const effectiveCount = Math.min(provinceCount, capacity);
	const groupAllocations = allocateSeedsBySizeWithCap(groupSizes, effectiveCount);
	const seedFaces: number[] = [];
	let provinceOffset = 0;

	for (let i = 0; i < provinceGroups.length; i += 1) {
		const group = provinceGroups[i];
		const seedCount = groupAllocations[i];
		if (seedCount <= 0) {
			continue;
		}
		const groupFaces = group.faces;
		const seeds = pickFarthestSeeds(groupFaces, mesh, seedCount, random);
		const actualSeedCount = seeds.length;
		if (actualSeedCount <= 0) {
			continue;
		}
		const groupIsLand = new Array<boolean>(faceCount).fill(false);
		for (let j = 0; j < groupFaces.length; j += 1) {
			groupIsLand[groupFaces[j]] = true;
		}
		const assignment = growProvinceRegions(
			mesh,
			groupIsLand,
			groupFaces,
			seeds,
			actualSeedCount,
			controls.spacing
		);
		for (let j = 0; j < groupFaces.length; j += 1) {
			const faceIndex = groupFaces[j];
			const localProvince = assignment.provinceByFace[faceIndex];
			if (localProvince >= 0) {
				provinceByFace[faceIndex] = localProvince + provinceOffset;
			}
		}
		for (let j = 0; j < groupFaces.length; j += 1) {
			const faceIndex = groupFaces[j];
			if (provinceByFace[faceIndex] >= 0) {
				continue;
			}
			const seedIndex = findNearestSeedIndex(mesh, faceIndex, seeds);
			provinceByFace[faceIndex] = provinceOffset + seedIndex;
		}
		seedFaces.push(...seeds);
		provinceOffset += actualSeedCount;
	}

	if (annexFaces.length > 0 && seedFaces.length > 0) {
		for (let i = 0; i < annexFaces.length; i += 1) {
			const faceIndex = annexFaces[i];
			if (provinceByFace[faceIndex] >= 0) {
				continue;
			}
			const seedIndex = findNearestSeedIndex(mesh, faceIndex, seedFaces);
			provinceByFace[faceIndex] = seedIndex;
		}
	}

	const hasUnassigned = landFaces.some((faceIndex) => provinceByFace[faceIndex] < 0);
	if (hasUnassigned && seedFaces.length > 0) {
		landFaces.forEach((faceIndex) => {
			if (provinceByFace[faceIndex] >= 0) {
				return;
			}
			const seedIndex = findNearestSeedIndex(mesh, faceIndex, seedFaces);
			provinceByFace[faceIndex] = seedIndex;
		});
	}

	const provinceGraph = buildProvinceGraph(mesh, provinceByFace, landFaces, isLand);
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

function getComponentStats(
	mesh: MeshGraph,
	components: number[][]
): { sizes: number[]; centers: Vec2[] } {
	const sizes = new Array<number>(components.length).fill(0);
	const centers = new Array<Vec2>(components.length);
	for (let i = 0; i < components.length; i += 1) {
		const component = components[i];
		const size = component.length;
		sizes[i] = size;
		let sumX = 0;
		let sumY = 0;
		for (let j = 0; j < size; j += 1) {
			const point = mesh.faces[component[j]].point;
			sumX += point.x;
			sumY += point.y;
		}
		const denom = size > 0 ? size : 1;
		centers[i] = { x: sumX / denom, y: sumY / denom };
	}
	return { sizes, centers };
}

function buildTinyComponentGroups(
	tinyComponentIds: number[],
	centers: Vec2[],
	radius: number
): number[][] {
	const groups: number[][] = [];
	if (tinyComponentIds.length === 0) {
		return groups;
	}
	const visited = new Array<boolean>(centers.length).fill(false);
	const radiusSq = radius * radius;
	for (let i = 0; i < tinyComponentIds.length; i += 1) {
		const startId = tinyComponentIds[i];
		if (visited[startId]) {
			continue;
		}
		const stack = [startId];
		const group: number[] = [];
		visited[startId] = true;
		while (stack.length > 0) {
			const current = stack.pop() as number;
			group.push(current);
			const currentCenter = centers[current];
			for (let j = 0; j < tinyComponentIds.length; j += 1) {
				const candidate = tinyComponentIds[j];
				if (visited[candidate]) {
					continue;
				}
				const delta = vec2Sub(currentCenter, centers[candidate]);
				if (vec2LenSq(delta) <= radiusSq) {
					visited[candidate] = true;
					stack.push(candidate);
				}
			}
		}
		groups.push(group);
	}
	return groups;
}

function allocateSeedsBySizeWithCap(sizes: number[], totalSeeds: number): number[] {
	const allocations = new Array<number>(sizes.length).fill(0);
	if (sizes.length === 0 || totalSeeds <= 0) {
		return allocations;
	}
	if (totalSeeds < sizes.length) {
		const sorted = sizes
			.map((size, index) => ({ index, size }))
			.sort((a, b) => b.size - a.size);
		for (let i = 0; i < totalSeeds; i += 1) {
			if (sizes[sorted[i].index] > 0) {
				allocations[sorted[i].index] = 1;
			}
		}
		return allocations;
	}

	for (let i = 0; i < sizes.length; i += 1) {
		if (sizes[i] > 0) {
			allocations[i] = 1;
		}
	}

	let remaining = totalSeeds - allocations.reduce((sum, value) => sum + value, 0);
	if (remaining > 0) {
		const totalSize = sizes.reduce((sum, value) => sum + value, 0);
		for (let i = 0; i < sizes.length; i += 1) {
			const capacity = Math.max(0, sizes[i] - allocations[i]);
			if (capacity <= 0) {
				continue;
			}
			const exact = totalSize > 0 ? (sizes[i] / totalSize) * remaining : 0;
			const extra = Math.min(capacity, Math.floor(exact));
			if (extra > 0) {
				allocations[i] += extra;
			}
		}
		remaining = totalSeeds - allocations.reduce((sum, value) => sum + value, 0);
		if (remaining > 0) {
			const sorted = sizes
				.map((size, index) => ({ index, size }))
				.sort((a, b) => b.size - a.size);
			for (let i = 0; i < sorted.length && remaining > 0; i += 1) {
				const index = sorted[i].index;
				while (allocations[index] < sizes[index] && remaining > 0) {
					allocations[index] += 1;
					remaining -= 1;
				}
			}
		}
	}
	return allocations;
}

function findNearestSeedIndex(mesh: MeshGraph, faceIndex: number, seedFaces: number[]): number {
	let bestSeed = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	const point = mesh.faces[faceIndex].point;
	for (let i = 0; i < seedFaces.length; i += 1) {
		const seedFace = seedFaces[i];
		const seedPoint = mesh.faces[seedFace].point;
		const dist = vec2Len(vec2Sub(point, seedPoint));
		if (dist < bestDist) {
			bestDist = dist;
			bestSeed = i;
		}
	}
	return bestSeed;
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

function buildProvinceGraph(
	mesh: MeshGraph,
	provinceByFace: number[],
	landFaces: number[],
	isLand: boolean[]
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
		}
		if (provinceB >= 0) {
			faces[provinceB].outerEdges.push(index);
			addAdjacent(provinceB, provinceA);
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
	provinceCount: number,
	spacing: number
): ProvinceSeedState {
	const faceCount = mesh.faces.length;
	const provinceByFace = new Array<number>(faceCount).fill(-1);
	const seedPoints = seedFaces.map((faceIndex) => mesh.faces[faceIndex].point);
	const actualProvinceCount = Math.min(provinceCount, seedFaces.length);
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
			if (!isLand[neighbor] || provinceByFace[neighbor] >= 0) {
				continue;
			}
			const dist = vec2Len(vec2Sub(mesh.faces[neighbor].point, seedPoints[entry.provinceId]));
			const score = dist + balanceWeight * (provinceSizes[entry.provinceId] / targetSize);
			heap.push({ score, dist, provinceId: entry.provinceId, faceId: neighbor });
		}
	}

	return { provinceByFace, seedFaces, landFaces, isLand };
}
