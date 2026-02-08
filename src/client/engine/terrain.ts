export type TerrainControls = {
	spacing: number;
	showPolygonGraph: boolean;
	showDualGraph: boolean;
	showCornerNodes: boolean;
	showCenterNodes: boolean;
	showInsertedPoints: boolean;
	provinceCount: number;
	provinceBorderWidth: number;
	showLandBorders: boolean;
	showShoreBorders: boolean;
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
};

type Vec2 = {
	x: number;
	y: number;
};

/**
 * Geometry layers:
 * - Base geometry: MeshGraph (straight edges) + baseCells (Voronoi polygons).
 * - Refined geometry: edgePolylines (noisy edges) + refinedCells (polygons stitched from polylines).
 * Refined geometry is derived from base geometry and used for rendering and borders.
 */

type MeshFace = {
	// Index into mesh.faces.
	index: number;
	// Site location for this face.
	point: Vec2;
	// Ordered loop of mesh.vertices that bound this face polygon (base geometry).
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
	// Midpoint of the straight edge segment (base geometry).
	midpoint: Vec2;
};

type MeshGraph = {
	faces: MeshFace[];
	vertices: MeshVertex[];
	edges: MeshEdge[];
};

type EdgePolyline = Vec2[];

type RefinedGeometry = {
	edgePolylines: EdgePolyline[];
	refinedCells: Vec2[][];
	insertedPoints: Vec2[];
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
	const provinceLayer = ensureProvinceLayer(terrainLayer);
	const meshOverlay = ensureMeshOverlay(terrainLayer);
	baseLayer.removeChildren();
	provinceLayer.removeChildren();

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
	const baseCells: Vec2[][] = new Array(sites.length);
	sites.forEach((site, index) => {
		baseCells[index] = buildVoronoiCell(config, site, sites);
	});

	const mesh = buildMeshGraph(sites, baseCells);
	assignIslandElevation(
		config,
		mesh,
		baseCells,
		random,
		controls.waterLevel,
		controls.waterRoughness,
		controls.waterNoiseScale,
		controls.waterNoiseStrength,
		controls.waterNoiseOctaves,
		controls.waterWarpScale,
		controls.waterWarpStrength
	);
	const landPalette = [0x2d5f3a, 0x3b7347, 0x4a8050, 0x5c8b61, 0x6d9570];
	const mountainPalette = [0x6f6a62, 0x8c8479, 0xa39b8e, 0xb8b0a2];
	const provinceResult = buildProvinces(mesh, controls, random);
	const refinedGeometry = buildRefinedGeometry(mesh, provinceResult, controls, intermediateRandom);

	mesh.faces.forEach((face) => {
		const refinedCell = refinedGeometry.refinedCells[face.index];
		const baseCell = baseCells[face.index];
		const cell = refinedCell && refinedCell.length >= 3 ? refinedCell : baseCell;
		if (!cell || cell.length < 3) {
			return;
		}
		let fillColor = landPalette[Math.floor(random() * landPalette.length)];
		let fillAlpha = 0.78;

		if (face.elevation <= 0) {
			const maxDepth = 6;
			const depthT = clamp((-face.elevation) / maxDepth, 0, 1);
			const shallow = 0x2f5f89;
			const deep = 0x0f2438;
			fillColor = lerpColor(shallow, deep, depthT);
			fillAlpha = 1;
		} else if (face.elevation === 1) {
			fillColor = 0x8c7b4f;
			fillAlpha = 0.82;
		} else if (face.elevation >= 3) {
			const mountainIndex = Math.min(mountainPalette.length - 1, face.elevation - 3);
			fillColor = mountainPalette[mountainIndex];
			fillAlpha = 0.86;
		}

		const terrain = new window.PIXI.Graphics();
		terrain.poly(flattenPolygon(cell), true);
		terrain.fill({ color: fillColor, alpha: fillAlpha });
		baseLayer.addChild(terrain);

		const isShoreWater =
			face.elevation <= 0 &&
			face.adjacentFaces.some((neighborIndex) => mesh.faces[neighborIndex].elevation >= 1);
		if (isShoreWater) {
			const strokes = new window.PIXI.Graphics();
			const strokeMask = new window.PIXI.Graphics();
			strokeMask.poly(flattenPolygon(cell), true);
			strokeMask.fill({ color: 0xffffff, alpha: 0.001 });
			strokeMask.visible = true;
			const bounds = getPolygonBounds(cell);
			const lineGap = 6;
			const lineColor = 0x0b0e12;
			const lineWidth = 2;
			const span = bounds.maxX - bounds.minX;
			const minLen = span * 0.5;
			const maxLen = span * 0.8;
			for (let y = bounds.minY; y <= bounds.maxY; y += lineGap) {
				const lengthT = hash2D(face.index, Math.floor(y), seed + 71);
				const length = minLen + (maxLen - minLen) * lengthT;
				const startT = hash2D(Math.floor(y), face.index, seed + 13);
				const startX = bounds.minX + (span - length) * startT;
				const endX = startX + length;
				const alpha = 0.1 + hash2D(Math.floor(y), face.index + 5, seed + 101) * 0.14;
				strokes.moveTo(startX, y);
				strokes.lineTo(endX, y);
				strokes.stroke({ width: lineWidth, color: lineColor, alpha });
			}
			strokes.mask = strokeMask;
			baseLayer.addChild(strokeMask);
			baseLayer.addChild(strokes);
		}
	});

	renderProvinceBorders(
		mesh,
		refinedGeometry,
		baseCells,
		provinceResult,
		config,
		controls,
		provinceLayer
	);
	terrainLayer[PROVINCE_CACHE_KEY] = {
		mesh,
		refinedGeometry,
		baseCells,
		provinceGraph: provinceResult,
		config,
	} satisfies ProvinceRenderCache;
	renderMeshOverlay(mesh, refinedGeometry.insertedPoints, meshOverlay);
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
function buildRefinedGeometry(
	mesh: MeshGraph,
	provinceGraph: ProvinceGraph,
	controls: TerrainControls,
	random: () => number
): RefinedGeometry {
	const { edgePolylines, insertedPoints } = buildEdgePolylines(mesh, provinceGraph, controls, random);
	const refinedCells = buildRefinedCells(mesh, edgePolylines);
	return { edgePolylines, refinedCells, insertedPoints };
}

function buildEdgePolylines(
	mesh: MeshGraph,
	provinceGraph: ProvinceGraph,
	controls: TerrainControls,
	random: () => number
): { edgePolylines: EdgePolyline[]; insertedPoints: Vec2[] } {
	const edgePolylines: EdgePolyline[] = new Array(mesh.edges.length);
	const insertedPoints: Vec2[] = [];
	const baseIterations = Math.max(0, Math.round(controls.intermediateMaxIterations));
	const baseRelMagnitude = controls.intermediateRelMagnitude;
	const baseAbsMagnitude = controls.intermediateAbsMagnitude;
	// Province borders get a subtler perturbation than internal edges.
	const borderNoiseScale = 0.35;
	const borderIterationScale = 0.6;

	for (let i = 0; i < mesh.edges.length; i += 1) {
		const edge = mesh.edges[i];
		const [faceA, faceB] = edge.faces;
		const v0 = mesh.vertices[edge.vertices[0]].point;
		const v1 = mesh.vertices[edge.vertices[1]].point;
		const edgeIndex = edge.index;

		if (faceA < 0 || faceB < 0) {
			edgePolylines[edgeIndex] = [v0, v1];
			continue;
		}

		const face0 = mesh.faces[faceA];
		const face1 = mesh.faces[faceB];
		const sameLevelWater = face0.elevation <= 0 && face0.elevation == face1.elevation;
		if (sameLevelWater) {
			edgePolylines[edgeIndex] = [v0, v1];
			continue;
		}
		const provinceA = provinceGraph.provinceByFace[faceA];
		const provinceB = provinceGraph.provinceByFace[faceB];
		const isProvinceBorder =
			provinceGraph.isLand[faceA] &&
			provinceGraph.isLand[faceB] &&
			provinceA >= 0 &&
			provinceB >= 0 &&
			provinceA !== provinceB;
		const noiseScale = isProvinceBorder ? borderNoiseScale : 1;
		const iterationLimit = Math.max(
			0,
			Math.round(baseIterations * (isProvinceBorder ? borderIterationScale : 1))
		);

		const inter = generateIntermediate(
			face0.point,
			face1.point,
			v0,
			v1,
			0,
			random,
			iterationLimit,
			controls.intermediateThreshold,
			baseRelMagnitude * noiseScale,
			baseAbsMagnitude * noiseScale
		);

		if (inter.length > 0) {
			insertedPoints.push(...inter);
			edgePolylines[edgeIndex] = [v0, ...inter, v1];
		} else {
			edgePolylines[edgeIndex] = [v0, v1];
		}
	}

	return { edgePolylines, insertedPoints };
}

function buildRefinedCells(mesh: MeshGraph, edgePolylines: EdgePolyline[]): Vec2[][] {
	const edgeLookup = new Map<string, number>();
	for (let i = 0; i < mesh.edges.length; i += 1) {
		const edge = mesh.edges[i];
		edgeLookup.set(edgeKey(edge.vertices[0], edge.vertices[1]), edge.index);
	}

	const refinedCells: Vec2[][] = new Array(mesh.faces.length);
	for (let i = 0; i < mesh.faces.length; i += 1) {
		const face = mesh.faces[i];
		if (!face.vertices || face.vertices.length < 3) {
			refinedCells[face.index] = [];
			continue;
		}
		const path: Vec2[] = [];
		const vertexCount = face.vertices.length;
		for (let j = 0; j < vertexCount; j += 1) {
			const a = face.vertices[j];
			const b = face.vertices[(j + 1) % vertexCount];
			const edgeIndex = edgeLookup.get(edgeKey(a, b));
			if (edgeIndex === undefined) {
				continue;
			}
			const edge = mesh.edges[edgeIndex];
			const polyline = edgePolylines[edgeIndex] ?? [
				mesh.vertices[edge.vertices[0]].point,
				mesh.vertices[edge.vertices[1]].point,
			];
			const forward = edge.vertices[0] === a && edge.vertices[1] === b;
			const segment = forward ? polyline : polyline.slice().reverse();
			appendPath(path, segment);
		}
		if (path.length > 2 && pointsEqual(path[0], path[path.length - 1])) {
			path.pop();
		}
		refinedCells[face.index] = path;
	}

	return refinedCells;
}

function appendPath(path: Vec2[], segment: Vec2[]): void {
	if (segment.length === 0) {
		return;
	}
	if (path.length === 0) {
		path.push(...segment);
		return;
	}
	if (pointsEqual(path[path.length - 1], segment[0])) {
		path.push(...segment.slice(1));
		return;
	}
	path.push(...segment);
}

function pointsEqual(a: Vec2, b: Vec2, epsilon = 1e-3): boolean {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy <= epsilon * epsilon;
}

function edgeKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
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

function getPolygonBounds(polygon: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < polygon.length; i += 1) {
		const point = polygon[i];
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	return { minX, maxX, minY, maxY };
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
	waterWarpStrength: number
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
	const islandSeed = Math.floor(random() * 0xffffffff);
	const bumps = 3 + Math.floor(normalizedRoughness * 7) + Math.floor(random() * 3);
	const startAngle = random() * Math.PI * 2;
	const borderEpsilon = 1;
	const baseRadius = 0.72 - normalizedWaterLevel * 0.2;
	const primaryWaveAmplitude = 0.06 + normalizedRoughness * 0.14;
	const secondaryWaveAmplitude = 0.03 + normalizedRoughness * 0.1;
	const noiseAmplitude = (0.08 + normalizedRoughness * 0.18) * clampedNoiseStrength;

	const islandShape = (point: Vec2): boolean => {
		const baseNx = (point.x / width) * 2 - 1;
		const baseNy = (point.y / height) * 2 - 1;
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

type ProvinceRenderCache = {
	mesh: MeshGraph;
	refinedGeometry: RefinedGeometry;
	baseCells: Vec2[][];
	provinceGraph: ProvinceGraph;
	config: TerrainConfig;
};

const BASE_LAYER_KEY = '__terrainBaseLayer';
const PROVINCE_LAYER_KEY = '__terrainProvinceLayer';
const MESH_OVERLAY_KEY = '__terrainGraphOverlay';
const PROVINCE_CACHE_KEY = '__terrainProvinceCache';

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

function ensureProvinceLayer(terrainLayer: any): any {
	const existing = terrainLayer[PROVINCE_LAYER_KEY];
	if (existing) {
		if (terrainLayer.children.length > 1) {
			terrainLayer.setChildIndex(existing, 1);
		}
		return existing;
	}
	const provinceLayer = new window.PIXI.Container();
	terrainLayer[PROVINCE_LAYER_KEY] = provinceLayer;
	const insertIndex = Math.min(1, terrainLayer.children.length);
	terrainLayer.addChildAt(provinceLayer, insertIndex);
	return provinceLayer;
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

export function updateProvinceBorders(terrainLayer: any, controls: TerrainControls): void {
	if (!terrainLayer) {
		return;
	}
	const cache = terrainLayer[PROVINCE_CACHE_KEY] as ProvinceRenderCache | undefined;
	if (!cache) {
		return;
	}
	const provinceLayer = ensureProvinceLayer(terrainLayer);
	provinceLayer.removeChildren();
	renderProvinceBorders(
		cache.mesh,
		cache.refinedGeometry,
		cache.baseCells,
		cache.provinceGraph,
		cache.config,
		controls,
		provinceLayer
	);
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

type ProvinceFace = {
	// Province index.
	index: number;
	// Indices into mesh.faces that belong to this province.
	faces: number[];
	// Indices into province.outerEdges that surround this province.
	outerEdges: number[];
	// Neighboring province indices (unique, excludes water).
	adjacentProvinces: number[];
};

type ProvinceOuterEdge = {
	// Index into province.outerEdges.
	index: number;
	// Index into mesh.edges that forms this boundary.
	edge: number;
	// Province ids on either side. Water/outside is -1.
	provinces: [number, number];
	// Face ids on either side. Outside is -1.
	faces: [number, number];
};

type ProvinceGraph = {
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

function buildProvinces(mesh: MeshGraph, controls: TerrainControls, random: () => number): ProvinceGraph {
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

	const provinceCount = clamp(Math.round(controls.provinceCount || 1), 1, landFaces.length);
	const components = getLandComponents(mesh, isLand);
	const componentAllocations = allocateProvinceSeeds(components, provinceCount);
	const seedFaces: number[] = [];

	for (let i = 0; i < components.length; i += 1) {
		const component = components[i];
		const seedCount = componentAllocations[i];
		if (seedCount <= 0) {
			continue;
		}
		const seeds = pickFarthestSeeds(component, mesh, seedCount, random);
		seedFaces.push(...seeds);
	}

	const assignment = growProvinceRegions(mesh, isLand, landFaces, seedFaces, provinceCount, controls.spacing);
	for (let i = 0; i < assignment.provinceByFace.length; i += 1) {
		provinceByFace[i] = assignment.provinceByFace[i];
	}

	const hasUnassigned = landFaces.some((faceIndex) => provinceByFace[faceIndex] < 0);
	if (hasUnassigned && seedFaces.length > 0) {
		landFaces.forEach((faceIndex) => {
			if (provinceByFace[faceIndex] >= 0) {
				return;
			}
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
			provinceByFace[faceIndex] = bestSeed;
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

function allocateProvinceSeeds(components: number[][], totalSeeds: number): number[] {
	const allocations = new Array<number>(components.length).fill(0);
	if (components.length === 0 || totalSeeds <= 0) {
		return allocations;
	}
	if (totalSeeds >= components.length) {
		components.forEach((_, index) => {
			allocations[index] = 1;
		});
		let remaining = totalSeeds - components.length;
		if (remaining > 0) {
			const totalLand = components.reduce((sum, component) => sum + component.length, 0);
			const remainders = components.map((component, index) => {
				const exact = (component.length / totalLand) * remaining;
				const extra = Math.floor(exact);
				allocations[index] += extra;
				return { index, remainder: exact - extra };
			});
			remaining = totalSeeds - allocations.reduce((sum, value) => sum + value, 0);
			remainders.sort((a, b) => b.remainder - a.remainder);
			for (let i = 0; i < remaining; i += 1) {
				allocations[remainders[i % remainders.length].index] += 1;
			}
		}
		return allocations;
	}

	const sorted = components
		.map((component, index) => ({ index, size: component.length }))
		.sort((a, b) => b.size - a.size);
	for (let i = 0; i < totalSeeds; i += 1) {
		allocations[sorted[i].index] = 1;
	}
	return allocations;
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

type ProvinceHeapEntry = {
	score: number;
	dist: number;
	provinceId: number;
	faceId: number;
};

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

function renderProvinceBorders(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	baseCells: Vec2[][],
	provinceAssignment: ProvinceGraph,
	config: TerrainConfig,
	controls: TerrainControls,
	provinceLayer: any
): void {
	const lineWidth = clamp(controls.provinceBorderWidth ?? 6.5, 1, 24);
	const lineAlpha = 0.75;
	const strokeCaps = { cap: 'round', join: 'round' } as const;
	const oceanWater = getOceanWaterFaces(mesh, baseCells, provinceAssignment.isLand, config);
	const provinceColors = assignProvinceColors(provinceAssignment, PROVINCE_BORDER_PALETTE);
	const provinceEdgeLists = buildProvinceEdgeLists(
		mesh,
		provinceAssignment,
		oceanWater,
		controls.showLandBorders,
		controls.showShoreBorders
	);

	for (let p = 0; p < provinceAssignment.faces.length; p += 1) {
		const borderEdges = provinceEdgeLists[p];
		if (!borderEdges || borderEdges.length === 0) {
			continue;
		}
		const paths = buildBorderPaths(mesh, refinedGeometry.edgePolylines, borderEdges);
		if (paths.length === 0) {
			continue;
		}
		const provinceLines = new window.PIXI.Graphics();
		const color = provinceColors[p] ?? PROVINCE_BORDER_PALETTE[0];
		for (let i = 0; i < paths.length; i += 1) {
			drawPath(provinceLines, paths[i]);
		}
		provinceLines.stroke({ width: lineWidth, color, alpha: lineAlpha, ...strokeCaps });

		const mask = new window.PIXI.Graphics();
		const provinceFaces = provinceAssignment.faces[p]?.faces ?? [];
		for (let i = 0; i < provinceFaces.length; i += 1) {
			const faceIndex = provinceFaces[i];
			const cell = refinedGeometry.refinedCells[faceIndex];
			if (!cell || cell.length < 3) {
				continue;
			}
			mask.poly(flattenPolygon(cell), true);
		}
		mask.fill({ color: 0xffffff, alpha: 0.001 });
		provinceLines.mask = mask;
		provinceLayer.addChild(provinceLines);
		provinceLayer.addChild(mask);
	}
}

const PROVINCE_BORDER_PALETTE = [0xd6453d, 0xf28c28, 0xf2d03b, 0x8b5cf6];

function assignProvinceColors(provinceGraph: ProvinceGraph, palette: number[]): number[] {
	const count = provinceGraph.faces.length;
	const colors = new Array<number>(count).fill(-1);
	if (count === 0) {
		return colors;
	}
	const order = provinceGraph.faces
		.map((face) => ({ index: face.index, degree: face.adjacentProvinces.length }))
		.sort((a, b) => b.degree - a.degree || a.index - b.index)
		.map((entry) => entry.index);

	const canUseColor = (provinceId: number, colorIndex: number): boolean => {
		const neighbors = provinceGraph.faces[provinceId]?.adjacentProvinces ?? [];
		for (let i = 0; i < neighbors.length; i += 1) {
			const neighbor = neighbors[i];
			if (colors[neighbor] === colorIndex) {
				return false;
			}
		}
		return true;
	};

	const backtrack = (pos: number): boolean => {
		if (pos >= order.length) {
			return true;
		}
		const provinceId = order[pos];
		for (let c = 0; c < palette.length; c += 1) {
			if (!canUseColor(provinceId, c)) {
				continue;
			}
			colors[provinceId] = c;
			if (backtrack(pos + 1)) {
				return true;
			}
			colors[provinceId] = -1;
		}
		return false;
	};

	if (!backtrack(0)) {
		for (let i = 0; i < order.length; i += 1) {
			const provinceId = order[i];
			for (let c = 0; c < palette.length; c += 1) {
				if (canUseColor(provinceId, c)) {
					colors[provinceId] = c;
					break;
				}
			}
			if (colors[provinceId] < 0) {
				colors[provinceId] = 0;
			}
		}
	}

	return colors.map((colorIndex) => palette[Math.max(0, colorIndex) % palette.length]);
}

function buildProvinceEdgeLists(
	mesh: MeshGraph,
	provinceGraph: ProvinceGraph,
	oceanWater: boolean[],
	showLandBorders: boolean,
	showShoreBorders: boolean
): number[][] {
	const provinceCount = provinceGraph.faces.length;
	const lists: number[][] = new Array(provinceCount);
	for (let i = 0; i < provinceCount; i += 1) {
		lists[i] = [];
	}

	for (let e = 0; e < mesh.edges.length; e += 1) {
		const edge = mesh.edges[e];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		const provinceA = provinceGraph.provinceByFace[faceA];
		const provinceB = provinceGraph.provinceByFace[faceB];
		const isLandA = provinceGraph.isLand[faceA];
		const isLandB = provinceGraph.isLand[faceB];
		const isProvinceBorder =
			showLandBorders &&
			isLandA &&
			isLandB &&
			provinceA >= 0 &&
			provinceB >= 0 &&
			provinceA !== provinceB;
		const isShoreBorder =
			showShoreBorders &&
			((isLandA && !isLandB && oceanWater[faceB]) || (!isLandA && isLandB && oceanWater[faceA]));
		if (!isProvinceBorder && !isShoreBorder) {
			continue;
		}
		if (isProvinceBorder) {
			lists[provinceA].push(edge.index);
			lists[provinceB].push(edge.index);
			continue;
		}
		const landProvince = isLandA ? provinceA : provinceB;
		if (landProvince >= 0) {
			lists[landProvince].push(edge.index);
		}
	}

	return lists;
}

function buildBorderPaths(mesh: MeshGraph, edgePolylines: EdgePolyline[], edgeIndices: number[]): Vec2[][] {
	const paths: Vec2[][] = [];
	const remaining = new Set<number>(edgeIndices);
	const adjacency = new Map<number, number[]>();

	const addAdjacency = (vertex: number, edgeIndex: number): void => {
		const list = adjacency.get(vertex);
		if (list) {
			list.push(edgeIndex);
		} else {
			adjacency.set(vertex, [edgeIndex]);
		}
	};

	for (let i = 0; i < edgeIndices.length; i += 1) {
		const edgeIndex = edgeIndices[i];
		const edge = mesh.edges[edgeIndex];
		addAdjacency(edge.vertices[0], edgeIndex);
		addAdjacency(edge.vertices[1], edgeIndex);
	}

	const pickStartVertex = (): number | null => {
		for (const [vertex, edges] of adjacency.entries()) {
			const count = edges.filter((edgeIndex) => remaining.has(edgeIndex)).length;
			if (count === 1) {
				return vertex;
			}
		}
		for (const [vertex, edges] of adjacency.entries()) {
			const count = edges.filter((edgeIndex) => remaining.has(edgeIndex)).length;
			if (count > 0) {
				return vertex;
			}
		}
		return null;
	};

	while (remaining.size > 0) {
		const startVertex = pickStartVertex();
		if (startVertex === null) {
			break;
		}
		let currentVertex = startVertex;
		let previousEdge: number | null = null;
		const path: Vec2[] = [];

		while (true) {
			const edgesAtVertex = adjacency.get(currentVertex) ?? [];
			let nextEdge: number | null = null;
			for (let i = 0; i < edgesAtVertex.length; i += 1) {
				const edgeIndex = edgesAtVertex[i];
				if (!remaining.has(edgeIndex)) {
					continue;
				}
				if (previousEdge !== null && edgeIndex === previousEdge) {
					continue;
				}
				nextEdge = edgeIndex;
				break;
			}
			if (nextEdge === null) {
				break;
			}
			remaining.delete(nextEdge);
			const edge = mesh.edges[nextEdge];
			const forward = edge.vertices[0] === currentVertex;
			const polyline = edgePolylines[nextEdge];
			if (polyline && polyline.length >= 2) {
				appendPath(path, forward ? polyline : polyline.slice().reverse());
			}
			previousEdge = nextEdge;
			currentVertex = forward ? edge.vertices[1] : edge.vertices[0];
			if (currentVertex === startVertex) {
				const remainingEdgesAtStart =
					(adjacency.get(startVertex) ?? []).filter((edgeIndex) => remaining.has(edgeIndex)).length;
				if (remainingEdgesAtStart === 0) {
					break;
				}
			}
		}

		if (path.length >= 2) {
			paths.push(path);
		}
	}

	return paths;
}

function getOceanWaterFaces(
	mesh: MeshGraph,
	cells: Vec2[][],
	isLand: boolean[],
	config: TerrainConfig
): boolean[] {
	const oceanWater = new Array<boolean>(mesh.faces.length).fill(false);
	const queue: number[] = [];
	const epsilon = 1;

	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (isLand[i]) {
			continue;
		}
		const cell = cells[i];
		if (!cell || cell.length === 0) {
			continue;
		}
		const touchesBorder = cell.some(
			(point) =>
				point.x <= epsilon ||
				point.x >= config.width - epsilon ||
				point.y <= epsilon ||
				point.y >= config.height - epsilon
		);
		if (touchesBorder) {
			oceanWater[i] = true;
			queue.push(i);
		}
	}

	for (let q = 0; q < queue.length; q += 1) {
		const faceIndex = queue[q];
		const face = mesh.faces[faceIndex];
		for (let j = 0; j < face.adjacentFaces.length; j += 1) {
			const neighbor = face.adjacentFaces[j];
			if (isLand[neighbor] || oceanWater[neighbor]) {
				continue;
			}
			oceanWater[neighbor] = true;
			queue.push(neighbor);
		}
	}

	return oceanWater;
}

function drawPath(graphics: any, path: Vec2[]): void {
	if (path.length < 2) {
		return;
	}
	graphics.moveTo(path[0].x, path[0].y);
	for (let i = 1; i < path.length; i += 1) {
		graphics.lineTo(path[i].x, path[i].y);
	}
}

function pushUnique(values: number[], value: number): void {
	if (!values.includes(value)) {
		values.push(value);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function lerpColor(a: number, b: number, t: number): number {
	const ar = (a >> 16) & 0xff;
	const ag = (a >> 8) & 0xff;
	const ab = a & 0xff;
	const br = (b >> 16) & 0xff;
	const bg = (b >> 8) & 0xff;
	const bb = b & 0xff;
	const rr = Math.round(lerp(ar, br, t));
	const rg = Math.round(lerp(ag, bg, t));
	const rb = Math.round(lerp(ab, bb, t));
	return (rr << 16) | (rg << 8) | rb;
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
