export type TerrainControls = {
	spacing: number;
	showPolygonGraph: boolean;
	showDualGraph: boolean;
	showCornerNodes: boolean;
	showCenterNodes: boolean;
	showInsertedPoints: boolean;
	seed: number;
	intermediateSeed: number;
	intermediateMaxIterations: number;
	intermediateThreshold: number;
	intermediateRelMagnitude: number;
	intermediateAbsMagnitude: number;
	waterLevel: number;
	waterRoughness: number;
	waterNoiseScale: number;
	waterNoiseStrength: number;
	waterNoiseOctaves: number;
	waterWarpScale: number;
	waterWarpStrength: number;
	waterOffsetX: number;
	waterOffsetY: number;
};

type Vec2 = {
	x: number;
	y: number;
};

type MeshFace = {
	// Index into mesh.faces.
	index: number;
	// Site location for this face.
	point: Vec2;
	// Indices into mesh.vertices that bound this face polygon.
	vertices: number[];
	// Adjacent face indices that share an edge with this face.
	adjacentFaces: number[];
	// Indices into mesh.edges that border this face.
	edges: number[];
	// Elevation classification used for rendering.
	elevation: number;
};

type MeshVertex = {
	// Index into mesh.vertices.
	index: number;
	// Vertex position.
	point: Vec2;
	// Indices into mesh.faces that meet at this vertex.
	faces: number[];
	// Indices into mesh.vertices connected by an edge.
	adjacentVertices: number[];
	// Indices into mesh.edges that touch this vertex.
	edges: number[];
	// Elevation classification used for rendering.
	elevation: number;
};

type MeshEdge = {
	// Index into mesh.edges.
	index: number;
	// Indices of adjacent faces (-1 for border).
	faces: [number, number];
	// Indices of endpoint vertices.
	vertices: [number, number];
	// Midpoint of the edge segment.
	midpoint: Vec2;
};

type MeshGraph = {
	faces: MeshFace[];
	vertices: MeshVertex[];
	edges: MeshEdge[];
};

type TerrainConfig = {
	width: number;
	height: number;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
});

const vec2Sub = (a: Vec2, b: Vec2): Vec2 => ({
	x: a.x - b.x,
	y: a.y - b.y,
});

const vec2Add = (a: Vec2, b: Vec2): Vec2 => ({
	x: a.x + b.x,
	y: a.y + b.y,
});

const vec2Mult = (a: Vec2, f: number): Vec2 => ({
	x: a.x * f,
	y: a.y * f,
});

const vec2LenSq = (v: Vec2): number => v.x * v.x + v.y * v.y;

const vec2Len = (v: Vec2): number => Math.hypot(v.x, v.y);

const vec2Normalize = (v: Vec2): Vec2 => {
	const length = vec2Len(v);
	if (length <= 0) {
		return { x: 0, y: 0 };
	}
	return { x: v.x / length, y: v.y / length };
};

const vec2Dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export function drawVoronoiTerrain(
	config: TerrainConfig,
	controls: TerrainControls,
	terrainLayer: any
): void {
	if (!terrainLayer || !window.PIXI) {
		return;
	}
	const baseLayer = ensureBaseLayer(terrainLayer);
	const meshOverlay = ensureMeshOverlay(terrainLayer);
	baseLayer.removeChildren();

	const waterTint = new window.PIXI.Graphics();
	waterTint.rect(0, 0, config.width, config.height);
	waterTint.fill({ color: 0x0d1a2e, alpha: 0.18 });
	baseLayer.addChild(waterTint);

	const seed = controls.seed >>> 0;
	const random = createRng(seed);
	const intermediateSeed = controls.intermediateSeed >>> 0;
	const intermediateRandom = createRng(intermediateSeed);
	const padding = 0;
	const sites = generatePoissonSites(config, controls.spacing, padding, random);
	const cells: Vec2[][] = new Array(sites.length);
	sites.forEach((site, index) => {
		cells[index] = buildVoronoiCell(config, site, sites);
	});

	const mesh = buildMeshGraph(sites, cells);
	assignIslandElevation(
		config,
		mesh,
		cells,
		random,
		controls.waterLevel,
		controls.waterRoughness,
		controls.waterNoiseScale,
		controls.waterNoiseStrength,
		controls.waterNoiseOctaves,
		controls.waterWarpScale,
		controls.waterWarpStrength,
		controls.waterOffsetX,
		controls.waterOffsetY
	);
	const landPalette = [0x2d5f3a, 0x3b7347, 0x4a8050, 0x5c8b61, 0x6d9570];
	const mountainPalette = [0x6f6a62, 0x8c8479, 0xa39b8e, 0xb8b0a2];
	const insertedPoints: Vec2[] = [];

	mesh.faces.forEach((face) => {
		face.adjacentFaces.forEach((adjacentId) => {
			if (adjacentId < face.index) {
				return;
			}

			if (face.elevation <= 0 && mesh.faces[adjacentId].elevation <= 0) {
				return;
			}

			const edgeId = findSharedEdgeIndex(mesh, face.index, adjacentId);

			if (edgeId < 0) {
				return;
			}

			const sharedEdge = mesh.edges[edgeId];
			const e0 = mesh.vertices[sharedEdge.vertices[0]].point;
			const e1 = mesh.vertices[sharedEdge.vertices[1]].point;

			const c0 = face.point;
			const c1 = mesh.faces[adjacentId].point;

			const inter = generateIntermediate(
				c0,
				c1,
				e0,
				e1,
				0,
				intermediateRandom,
				controls.intermediateMaxIterations,
				controls.intermediateThreshold,
				controls.intermediateRelMagnitude,
				controls.intermediateAbsMagnitude
	);

			if (inter.length > 0) {
				insertedPoints.push(...inter);

				const cell0 = cells[face.index];
				const insert0 = findEdgeInsertion(cell0, e0, e1);
				if (insert0) {
					insertAfter(cell0, insert0.index, insert0.reverse ? inter.slice().reverse() : inter);
				}

				const cell1 = cells[adjacentId];
				const insert1 = findEdgeInsertion(cell1, e0, e1);
				if (insert1) {
					insertAfter(cell1, insert1.index, insert1.reverse ? inter.slice().reverse() : inter);
				}
			}
		});
	});

	mesh.faces.forEach((face) => {
		const cell = cells[face.index];
		if (!cell || cell.length < 3) {
			return;
		}
		let fillColor = landPalette[Math.floor(random() * landPalette.length)];
		let fillAlpha = 0.78;
		let strokeColor = 0xcadfb8;
		let strokeAlpha = 0.42;

		if (face.elevation <= -2) {
			fillColor = 0x0f2b4a;
			fillAlpha = 0.9;
			strokeColor = 0x6f95c4;
			strokeAlpha = 0.34;
		} else if (face.elevation <= 0) {
			fillColor = 0x2d5f8d;
			fillAlpha = 0.84;
			strokeColor = 0x9dc2e6;
			strokeAlpha = 0.35;
		} else if (face.elevation === 1) {
			fillColor = 0x8c7b4f;
			fillAlpha = 0.82;
			strokeColor = 0xdac38e;
			strokeAlpha = 0.38;
		} else if (face.elevation >= 3) {
			const mountainIndex = Math.min(mountainPalette.length - 1, face.elevation - 3);
			fillColor = mountainPalette[mountainIndex];
			fillAlpha = 0.86;
			strokeColor = 0xd7d0c2;
			strokeAlpha = 0.32;
		}

		const terrain = new window.PIXI.Graphics();
		terrain.poly(flattenPolygon(cell), true);
		terrain.fill({ color: fillColor, alpha: fillAlpha });
		terrain.stroke({ width: 1.2, color: strokeColor, alpha: strokeAlpha });
		baseLayer.addChild(terrain);
	});

	renderMeshOverlay(mesh, insertedPoints, meshOverlay);
	setGraphOverlayVisibility(terrainLayer, controls);
}

function vec2Midpoint(p1: Vec2, p2: Vec2): Vec2 {
	return {
		x: (p1.x + p2.x) * 0.5,
		y: (p1.y + p2.y) * 0.5,
	};
};

function generateIntermediate(
	c0: Vec2,
	c1: Vec2,
	e0: Vec2,
	e1: Vec2,
	iteration: number,
	random: () => number,
	maxIterations: number,
	threshold: number,
	relMagnitude: number,
	absMagnitude: number
): Vec2[] {
	const ln = vec2Len(vec2Sub(e0, e1));
	if (ln < threshold || iteration > maxIterations) {
		return [];
	}

	const mag = absMagnitude + ln * relMagnitude;

	const dir = vec2Normalize(vec2Sub(c1, c0));
	const mid = vec2Midpoint(e0, e1);
	const insertPoint = vec2Add(mid, vec2Mult(dir, (random() - .5) * 2 * mag)); 

	const nextIteration = iteration + 1;
	const left = generateIntermediate(
		vec2Midpoint(e0, c0),
		vec2Midpoint(e0, c1),
		e0,
		insertPoint,
		nextIteration,
		random,
		maxIterations,
		threshold,
		relMagnitude,
		absMagnitude
	);
	const right = generateIntermediate(
		vec2Midpoint(e1, c0),
		vec2Midpoint(e1, c1),
		insertPoint,
		e1,
		nextIteration,
		random,
		maxIterations,
		threshold,
		relMagnitude,
		absMagnitude
	);

	return left.concat(insertPoint).concat(right);
}
function findSharedEdgeIndex(mesh: MeshGraph, face1: number, face2: number): number {
	if (face1 < 0 || face2 < 0) {
		return -1;
	}
	const face = mesh.faces[face1];
	if (!face) {
		return -1;
	}
	for (let i = 0; i < face.edges.length; i += 1) {
		const edgeIndex = face.edges[i];
		const edge = mesh.edges[edgeIndex];
		if (!edge) {
			continue;
		}
		const [a, b] = edge.faces;
		if ((a === face1 && b === face2) || (a === face2 && b === face1)) {
			return edgeIndex;
		}
	}
	return -1;
}

function findVertexIndex(cell: Vec2[], vertex: Vec2, epsilon = 1e-3): number {
	const epsilonSq = epsilon * epsilon;
	for (let i = 0; i < cell.length; i += 1) {
		const point = cell[i];
		const dx = point.x - vertex.x;
		const dy = point.y - vertex.y;
		if (dx * dx + dy * dy <= epsilonSq) {
			return i;
		}
	}
	return -1;
}

function insertAfter(cell: Vec2[], vertexIndex: number, points: Vec2[]): void {
	if (points.length === 0) {
		return;
	}
	cell.splice(vertexIndex + 1, 0, ...points);
}

function findEdgeInsertion(
	cell: Vec2[] | undefined,
	a: Vec2,
	b: Vec2
): { index: number; reverse: boolean } | null {
	if (!cell || cell.length < 2) {
		return null;
	}
	const ia = findVertexIndex(cell, a);
	const ib = findVertexIndex(cell, b);
	if (ia < 0 || ib < 0) {
		return null;
	}
	const nextOfA = (ia + 1) % cell.length;
	if (nextOfA === ib) {
		return { index: ia, reverse: false };
	}
	const nextOfB = (ib + 1) % cell.length;
	if (nextOfB === ia) {
		return { index: ib, reverse: true };
	}
	return null;
}

function generatePoissonSites(
	config: TerrainConfig,
	spacing: number,
	padding: number,
	random: () => number
): Vec2[] {
	return samplePoissonDisc(config, spacing, padding, random);
}

function samplePoissonDisc(
	config: TerrainConfig,
	minDistance: number,
	padding: number,
	random: () => number
): Vec2[] {
	const maxAttemptsPerActivePoint = 30;
	const width = config.width - padding * 2;
	const height = config.height - padding * 2;
	if (width <= 0 || height <= 0) {
		return [];
	}

	const cellSize = minDistance / Math.sqrt(2);
	const gridWidth = Math.max(1, Math.ceil(width / cellSize));
	const gridHeight = Math.max(1, Math.ceil(height / cellSize));
	const grid = new Array<number>(gridWidth * gridHeight).fill(-1);
	const points: Vec2[] = [];
	const active: number[] = [];

	const toGridX = (x: number): number => Math.floor((x - padding) / cellSize);
	const toGridY = (y: number): number => Math.floor((y - padding) / cellSize);
	const isInBounds = (point: Vec2): boolean =>
		point.x >= padding &&
		point.x <= config.width - padding &&
		point.y >= padding &&
		point.y <= config.height - padding;

	const registerPoint = (point: Vec2): void => {
		points.push(point);
		const index = points.length - 1;
		active.push(index);
		const gx = clamp(toGridX(point.x), 0, gridWidth - 1);
		const gy = clamp(toGridY(point.y), 0, gridHeight - 1);
		grid[gy * gridWidth + gx] = index;
	};

	const isFarEnough = (point: Vec2): boolean => {
		if (!isInBounds(point)) {
			return false;
		}
		const gx = clamp(toGridX(point.x), 0, gridWidth - 1);
		const gy = clamp(toGridY(point.y), 0, gridHeight - 1);
		const minGridX = Math.max(0, gx - 2);
		const maxGridX = Math.min(gridWidth - 1, gx + 2);
		const minGridY = Math.max(0, gy - 2);
		const maxGridY = Math.min(gridHeight - 1, gy + 2);
		const minDistanceSquared = minDistance * minDistance;

		for (let y = minGridY; y <= maxGridY; y += 1) {
			for (let x = minGridX; x <= maxGridX; x += 1) {
				const pointIndex = grid[y * gridWidth + x];
				if (pointIndex < 0) {
					continue;
				}
				const other = points[pointIndex];
				const dx = other.x - point.x;
				const dy = other.y - point.y;
				if (dx * dx + dy * dy < minDistanceSquared) {
					return false;
				}
			}
		}
		return true;
	};

	registerPoint({
		x: padding + random() * width,
		y: padding + random() * height,
	});

	while (active.length > 0) {
		const activeListIndex = Math.floor(random() * active.length);
		const originIndex = active[activeListIndex];
		const origin = points[originIndex];
		let foundCandidate = false;

		for (let attempt = 0; attempt < maxAttemptsPerActivePoint; attempt += 1) {
			const angle = random() * Math.PI * 2;
			const radius = minDistance * (1 + random());
			const candidate = {
				x: origin.x + Math.cos(angle) * radius,
				y: origin.y + Math.sin(angle) * radius,
			};
			if (!isFarEnough(candidate)) {
				continue;
			}
			registerPoint(candidate);
			foundCandidate = true;
			break;
		}

		if (!foundCandidate) {
			const lastIndex = active.length - 1;
			active[activeListIndex] = active[lastIndex];
			active.pop();
		}
	}

	return points;
}

function buildVoronoiCell(config: TerrainConfig, site: Vec2, sites: Vec2[]): Vec2[] {
	let polygon: Vec2[] = [
		{ x: 0, y: 0 },
		{ x: config.width, y: 0 },
		{ x: config.width, y: config.height },
		{ x: 0, y: config.height },
	];

	for (let i = 0; i < sites.length; i += 1) {
		const other = sites[i];
		if (other === site) {
			continue;
		}
		const midpoint = {
			x: (site.x + other.x) * 0.5,
			y: (site.y + other.y) * 0.5,
		};
		const normal = {
			x: other.x - site.x,
			y: other.y - site.y,
		};
		polygon = clipPolygonWithHalfPlane(polygon, midpoint, normal);
		if (polygon.length < 3) {
			return [];
		}
	}

	return polygon;
}

function clipPolygonWithHalfPlane(polygon: Vec2[], midpoint: Vec2, normal: Vec2): Vec2[] {
	if (polygon.length === 0) {
		return [];
	}
	const clipped: Vec2[] = [];
	const epsilon = 1e-6;

	for (let i = 0; i < polygon.length; i += 1) {
		const current = polygon[i];
		const next = polygon[(i + 1) % polygon.length];
		const currentValue = evaluateLine(current, midpoint, normal);
		const nextValue = evaluateLine(next, midpoint, normal);
		const currentInside = currentValue <= epsilon;
		const nextInside = nextValue <= epsilon;

		if (currentInside && nextInside) {
			clipped.push(next);
		} else if (currentInside && !nextInside) {
			clipped.push(intersectSegmentWithLine(current, next, midpoint, currentValue, nextValue));
		} else if (!currentInside && nextInside) {
			clipped.push(intersectSegmentWithLine(current, next, midpoint, currentValue, nextValue));
			clipped.push(next);
		}
	}

	return clipped;
}

function evaluateLine(point: Vec2, midpoint: Vec2, normal: Vec2): number {
	return (point.x - midpoint.x) * normal.x + (point.y - midpoint.y) * normal.y;
}

function intersectSegmentWithLine(
	start: Vec2,
	end: Vec2,
	midpoint: Vec2,
	startValue: number,
	endValue: number
): Vec2 {
	const denominator = startValue - endValue;
	if (Math.abs(denominator) < 1e-9) {
		return {
			x: (start.x + end.x) * 0.5,
			y: (start.y + end.y) * 0.5,
		};
	}
	const t = startValue / denominator;
	const clampedT = Math.max(0, Math.min(1, t));
	const intersection = {
		x: start.x + (end.x - start.x) * clampedT,
		y: start.y + (end.y - start.y) * clampedT,
	};
	if (Number.isFinite(intersection.x) && Number.isFinite(intersection.y)) {
		return intersection;
	}
	return {
		x: midpoint.x,
		y: midpoint.y,
	};
}

function flattenPolygon(polygon: Vec2[]): number[] {
	const flat: number[] = [];
	for (let i = 0; i < polygon.length; i += 1) {
		flat.push(polygon[i].x, polygon[i].y);
	}
	return flat;
}

function buildMeshGraph(sites: Vec2[], cells: Vec2[][]): MeshGraph {
	const faces: MeshFace[] = sites.map((site, index) => ({
		index,
		point: site,
		vertices: [],
		adjacentFaces: [],
		edges: [],
		elevation: 2,
	}));
	const vertices: MeshVertex[] = [];
	const edges: MeshEdge[] = [];
	const cornerLookup = new Map<string, number>();
	const edgeLookup = new Map<string, number>();

	const quantize = (value: number): number => Math.round(value * 1000);
	const cornerKey = (point: Vec2): string => quantize(point.x) + ':' + quantize(point.y);
	const edgeKey = (a: number, b: number): string => (a < b ? a + ':' + b : b + ':' + a);

	const getCornerIndex = (point: Vec2): number => {
		const key = cornerKey(point);
		const existing = cornerLookup.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const index = vertices.length;
		vertices.push({
			index,
			point: { x: point.x, y: point.y },
			faces: [],
			adjacentVertices: [],
			edges: [],
			elevation: 2,
		});
		cornerLookup.set(key, index);
		return index;
	};

	cells.forEach((cell, centerIndex) => {
		if (!cell || cell.length < 3) {
			return;
		}
		const face = faces[centerIndex];
		const cellVertexIndices: number[] = [];
		for (let i = 0; i < cell.length; i += 1) {
			const cornerIndex = getCornerIndex(cell[i]);
			cellVertexIndices.push(cornerIndex);
			pushUnique(vertices[cornerIndex].faces, centerIndex);
			pushUnique(face.vertices, cornerIndex);
		}
		for (let i = 0; i < cellVertexIndices.length; i += 1) {
			const a = cellVertexIndices[i];
			const b = cellVertexIndices[(i + 1) % cellVertexIndices.length];
			const key = edgeKey(a, b);
			let borderIndex = edgeLookup.get(key);
			if (borderIndex === undefined) {
				borderIndex = edges.length;
				const vertexA = vertices[a].point;
				const vertexB = vertices[b].point;
				edges.push({
					index: borderIndex,
					faces: [centerIndex, -1],
					vertices: [a, b],
					midpoint: {
						x: (vertexA.x + vertexB.x) * 0.5,
						y: (vertexA.y + vertexB.y) * 0.5,
					},
				});
				edgeLookup.set(key, borderIndex);
			} else {
				const edge = edges[borderIndex];
				if (edge.faces[0] !== centerIndex && edge.faces[1] !== centerIndex) {
					edge.faces[1] = centerIndex;
				}
			}
			pushUnique(face.edges, borderIndex);
		}
	});

	edges.forEach((edge) => {
		const [vertexA, vertexB] = edge.vertices;
		pushUnique(vertices[vertexA].adjacentVertices, vertexB);
		pushUnique(vertices[vertexB].adjacentVertices, vertexA);
		pushUnique(vertices[vertexA].edges, edge.index);
		pushUnique(vertices[vertexB].edges, edge.index);

		const [faceA, faceB] = edge.faces;
		if (faceA >= 0) {
			pushUnique(faces[faceA].edges, edge.index);
		}
		if (faceB >= 0) {
			pushUnique(faces[faceB].edges, edge.index);
		}
		if (faceA >= 0 && faceB >= 0) {
			pushUnique(faces[faceA].adjacentFaces, faceB);
			pushUnique(faces[faceB].adjacentFaces, faceA);
		}
	});

	return { faces, vertices, edges };
}

function assignIslandElevation(
	config: TerrainConfig,
	mesh: MeshGraph,
	cells: Vec2[][],
	random: () => number,
	waterLevel: number,
	waterRoughness: number,
	waterNoiseScale: number,
	waterNoiseStrength: number,
	waterNoiseOctaves: number,
	waterWarpScale: number,
	waterWarpStrength: number,
	waterOffsetX: number,
	waterOffsetY: number
): void {
	const width = config.width;
	const height = config.height;
	const normalizedWaterLevel = clamp(waterLevel, -40, 40) / 40;
	const normalizedRoughness = clamp(waterRoughness, 0, 100) / 100;
	const clampedNoiseScale = clamp(waterNoiseScale, 2, 60);
	const clampedNoiseStrength = clamp(waterNoiseStrength, 0, 1);
	const clampedNoiseOctaves = Math.round(clamp(waterNoiseOctaves, 1, 6));
	const clampedWarpScale = clamp(waterWarpScale, 2, 40);
	const clampedWarpStrength = clamp(waterWarpStrength, 0, 0.8);
	const offsetX = clamp(waterOffsetX, -40, 40) / 100;
	const offsetY = clamp(waterOffsetY, -40, 40) / 100;
	const islandSeed = Math.floor(random() * 0xffffffff);
	const bumps = 3 + Math.floor(normalizedRoughness * 7) + Math.floor(random() * 3);
	const startAngle = random() * Math.PI * 2;
	const borderEpsilon = 1;
	const baseRadius = 0.72 - normalizedWaterLevel * 0.2;
	const primaryWaveAmplitude = 0.06 + normalizedRoughness * 0.14;
	const secondaryWaveAmplitude = 0.03 + normalizedRoughness * 0.1;
	const noiseAmplitude = (0.08 + normalizedRoughness * 0.18) * clampedNoiseStrength;

	const islandShape = (point: Vec2): boolean => {
		const baseNx = (point.x / width) * 2 - 1 + offsetX;
		const baseNy = (point.y / height) * 2 - 1 + offsetY;
		let nx = baseNx;
		let ny = baseNy;
		if (clampedWarpStrength > 0) {
			const warpX =
				fbmValueNoise(baseNx * clampedWarpScale, baseNy * clampedWarpScale, islandSeed + 17, 3) *
					2 -
				1;
			const warpY =
				fbmValueNoise(
					(baseNx + 9.2) * clampedWarpScale,
					(baseNy - 4.6) * clampedWarpScale,
					islandSeed + 31,
					3
				) *
					2 -
				1;
			nx += warpX * clampedWarpStrength;
			ny += warpY * clampedWarpStrength;
		}
		const angle = Math.atan2(ny, nx);
		const length = Math.hypot(nx, ny);
		const noise =
			fbmValueNoise(nx * clampedNoiseScale, ny * clampedNoiseScale, islandSeed, clampedNoiseOctaves) *
				2 -
			1;
		const radius = clamp(
			baseRadius +
				primaryWaveAmplitude * Math.sin(startAngle + bumps * angle + Math.cos((bumps + 2) * angle)) +
				secondaryWaveAmplitude * Math.sin(startAngle * 0.7 + (bumps + 3) * angle) +
				noiseAmplitude * noise,
			0.12,
			0.98
		);
		return length < radius;
	};

	const touchesBorder = (centerIndex: number): boolean => {
		const cell = cells[centerIndex];
		if (!cell || cell.length === 0) {
			return true;
		}
		return cell.some(
			(point) =>
				point.x <= borderEpsilon ||
				point.x >= width - borderEpsilon ||
				point.y <= borderEpsilon ||
				point.y >= height - borderEpsilon
		);
	};

	const faceCount = mesh.faces.length;
	const isLand = new Array<boolean>(faceCount).fill(false);
	const hasLand = mesh.faces.some((face) => !touchesBorder(face.index) && islandShape(face.point));
	const hasWater = mesh.faces.some((face) => touchesBorder(face.index) || !islandShape(face.point));

	mesh.faces.forEach((face) => {
		const land = !touchesBorder(face.index) && islandShape(face.point);
		isLand[face.index] = land;
	});

	const landElevation = new Array<number>(faceCount).fill(Number.NaN);
	const waterElevation = new Array<number>(faceCount).fill(Number.NaN);
	const landQueue: number[] = [];
	const waterQueue: number[] = [];

	if (hasWater && hasLand) {
		mesh.faces.forEach((face) => {
			if (isLand[face.index]) {
				const isShore = face.adjacentFaces.some((neighborIndex) => !isLand[neighborIndex]);
				if (isShore) {
					landElevation[face.index] = 1;
					landQueue.push(face.index);
				}
			} else {
				const isShoreWater = face.adjacentFaces.some((neighborIndex) => isLand[neighborIndex]);
				if (isShoreWater) {
					waterElevation[face.index] = 0;
					waterQueue.push(face.index);
				}
			}
		});

		for (let q = 0; q < landQueue.length; q += 1) {
			const face = mesh.faces[landQueue[q]];
			const currentElevation = landElevation[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (!isLand[neighborIndex]) {
					continue;
				}
				if (Number.isNaN(landElevation[neighborIndex])) {
					landElevation[neighborIndex] = currentElevation + 1;
					landQueue.push(neighborIndex);
				}
			}
		}

		for (let q = 0; q < waterQueue.length; q += 1) {
			const face = mesh.faces[waterQueue[q]];
			const currentElevation = waterElevation[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (isLand[neighborIndex]) {
					continue;
				}
				if (Number.isNaN(waterElevation[neighborIndex])) {
					waterElevation[neighborIndex] = currentElevation - 1;
					waterQueue.push(neighborIndex);
				}
			}
		}
	}

	mesh.faces.forEach((face) => {
		if (!hasWater && hasLand) {
			face.elevation = 2;
			return;
		}
		if (!hasLand && hasWater) {
			face.elevation = 0;
			return;
		}
		if (isLand[face.index]) {
			const elevation = landElevation[face.index];
			face.elevation = Number.isNaN(elevation) ? 2 : elevation;
		} else {
			const elevation = waterElevation[face.index];
			face.elevation = Number.isNaN(elevation) ? 0 : elevation;
		}
	});

	mesh.vertices.forEach((vertex) => {
		if (vertex.faces.length === 0) {
			vertex.elevation = 0;
			return;
		}
		let sum = 0;
		for (let i = 0; i < vertex.faces.length; i += 1) {
			sum += mesh.faces[vertex.faces[i]].elevation;
		}
		vertex.elevation = sum / vertex.faces.length;
	});
}

type MeshOverlay = {
	container: any;
	polygonGraph: any;
	dualGraph: any;
	cornerNodes: any;
	centerNodes: any;
	insertedNodes: any;
};

const BASE_LAYER_KEY = '__terrainBaseLayer';
const MESH_OVERLAY_KEY = '__terrainGraphOverlay';

function ensureBaseLayer(terrainLayer: any): any {
	const existing = terrainLayer[BASE_LAYER_KEY];
	if (existing) {
		terrainLayer.addChildAt(existing, 0);
		return existing;
	}
	const baseLayer = new window.PIXI.Container();
	terrainLayer[BASE_LAYER_KEY] = baseLayer;
	terrainLayer.addChildAt(baseLayer, 0);
	return baseLayer;
}

function ensureMeshOverlay(terrainLayer: any): MeshOverlay {
	const existing = terrainLayer[MESH_OVERLAY_KEY];
	if (existing) {
		const overlay = existing as MeshOverlay;
		terrainLayer.setChildIndex(overlay.container, terrainLayer.children.length - 1);
		return overlay;
	}
	const container = new window.PIXI.Container();
	const polygonGraph = new window.PIXI.Graphics();
	const dualGraph = new window.PIXI.Graphics();
	const cornerNodes = new window.PIXI.Graphics();
	const centerNodes = new window.PIXI.Graphics();
	const insertedNodes = new window.PIXI.Graphics();
	container.addChild(polygonGraph);
	container.addChild(dualGraph);
	container.addChild(cornerNodes);
	container.addChild(centerNodes);
	container.addChild(insertedNodes);
	terrainLayer.addChild(container);
	const overlay = { container, polygonGraph, dualGraph, cornerNodes, centerNodes, insertedNodes };
	terrainLayer[MESH_OVERLAY_KEY] = overlay;
	return overlay;
}

export function setGraphOverlayVisibility(terrainLayer: any, controls: TerrainControls): void {
	if (!terrainLayer) {
		return;
	}
	const overlay = terrainLayer[MESH_OVERLAY_KEY] as MeshOverlay | undefined;
	if (!overlay) {
		return;
	}
	overlay.polygonGraph.visible = controls.showPolygonGraph;
	overlay.dualGraph.visible = controls.showDualGraph;
	overlay.cornerNodes.visible = controls.showCornerNodes;
	overlay.centerNodes.visible = controls.showCenterNodes;
	overlay.insertedNodes.visible = controls.showInsertedPoints;
	overlay.container.visible =
		controls.showPolygonGraph ||
		controls.showDualGraph ||
		controls.showCornerNodes ||
		controls.showCenterNodes ||
		controls.showInsertedPoints;
}

function renderMeshOverlay(mesh: MeshGraph, insertedPoints: Vec2[], overlay: MeshOverlay): void {
	overlay.polygonGraph.clear();
	overlay.dualGraph.clear();
	overlay.cornerNodes.clear();
	overlay.centerNodes.clear();
	overlay.insertedNodes.clear();

	const polygonGraph = overlay.polygonGraph;
	mesh.edges.forEach((edge) => {
		const vertexA = mesh.vertices[edge.vertices[0]].point;
		const vertexB = mesh.vertices[edge.vertices[1]].point;
		polygonGraph.moveTo(vertexA.x, vertexA.y);
		polygonGraph.lineTo(vertexB.x, vertexB.y);
	});
	polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });

	const dualGraph = overlay.dualGraph;
	mesh.edges.forEach((edge) => {
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			return;
		}
		const a = mesh.faces[faceA].point;
		const b = mesh.faces[faceB].point;
		dualGraph.moveTo(a.x, a.y);
		dualGraph.lineTo(b.x, b.y);
	});
	dualGraph.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });

	const cornerNodes = overlay.cornerNodes;
	mesh.vertices.forEach((vertex) => {
		cornerNodes.circle(vertex.point.x, vertex.point.y, 1.8);
	});
	cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });

	const centerNodes = overlay.centerNodes;
	mesh.faces.forEach((face) => {
		centerNodes.circle(face.point.x, face.point.y, 2.3);
	});
	centerNodes.fill({ color: 0xff00c9, alpha: 0.95 });

	const insertedNodes = overlay.insertedNodes;
	for (let i = 0; i < insertedPoints.length; i += 1) {
		const point = insertedPoints[i];
		insertedNodes.circle(point.x, point.y, 2.2);
	}
	insertedNodes.fill({ color: 0xffe56b, alpha: 0.9 });
}

function pushUnique(values: number[], value: number): void {
	if (!values.includes(value)) {
		values.push(value);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function smoothstep(t: number): number {
	return t * t * (3 - 2 * t);
}

function hash2D(x: number, y: number, seed: number): number {
	let n = x * 374761393 + y * 668265263 + seed * 2654435761;
	n = (n ^ (n >>> 13)) * 1274126177;
	n = (n ^ (n >>> 16)) >>> 0;
	return n / 4294967296;
}

function valueNoise2D(x: number, y: number, seed: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = x0 + 1;
	const y1 = y0 + 1;
	const sx = smoothstep(x - x0);
	const sy = smoothstep(y - y0);
	const n00 = hash2D(x0, y0, seed);
	const n10 = hash2D(x1, y0, seed);
	const n01 = hash2D(x0, y1, seed);
	const n11 = hash2D(x1, y1, seed);
	const ix0 = lerp(n00, n10, sx);
	const ix1 = lerp(n01, n11, sx);
	return lerp(ix0, ix1, sy);
}

function fbmValueNoise(x: number, y: number, seed: number, octaves: number): number {
	let amp = 1;
	let freq = 1;
	let sum = 0;
	let norm = 0;
	for (let i = 0; i < octaves; i += 1) {
		sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 1013);
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return norm > 0 ? sum / norm : 0;
}

function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}
