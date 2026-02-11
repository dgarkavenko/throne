import { basegenPolitical } from './political';
import {
	clamp,
	lerp,
	smoothstep,
	vec2Add,
	vec2Len,
	vec2LenSq,
	vec2Midpoint,
	vec2Mult,
	vec2Normalize,
	vec2Sub,
	type Vec2,
} from './throne-math';
import { Graphics, Container } from "pixi.js";

export type TerrainControls = {
	spacing: number;
	showPolygonGraph: boolean;
	showDualGraph: boolean;
	showCornerNodes: boolean;
	showCenterNodes: boolean;
	showInsertedPoints: boolean;
	provinceCount: number;
	provinceBorderWidth: number;
	provinceSizeVariance: number;
	provincePassageElevation: number;
	provinceRiverPenalty: number;
	provinceSmallIslandMultiplier: number;
	provinceArchipelagoMultiplier: number;
	provinceIslandSingleMultiplier: number;
	provinceArchipelagoRadiusMultiplier: number;
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
	riverDensity: number;
	riverBranchChance: number;
	riverClimbChance: number;
	landRelief: number;
	ridgeStrength: number;
	ridgeCount: number;
	plateauStrength: number;
	ridgeDistribution: number;
	ridgeSeparation: number;
	ridgeContinuity: number;
	ridgeContinuityThreshold: number;
	oceanPeakClamp: number;
	ridgeWidth: number;
	ridgeOceanClamp: number;
};

// Land generation controls:
// landRelief: scales inland elevation (0..1).
// ridgeStrength: height contribution from ridges (0..1).
// ridgeCount: number of ridge seeds (1..10).
// plateauStrength: lowland smoothing amount (0..1).
// ridgeDistribution: spreads ridge influence further from seeds (0..1).
// ridgeSeparation: favors peaks far from existing peaks (0..1).
// ridgeContinuity: how far ridges connect toward nearest peaks (0..1).
// ridgeContinuityThreshold: limits ridge connections to nearby peaks (0..1; 0 = max distance, 1 = min distance).
// oceanPeakClamp: caps max elevation by ocean distance (0..1; 1 => cap at 2x sea distance).
// ridgeWidth: widens ridge connections into neighboring tiles (0..1).
// ridgeOceanClamp: caps ridge boost by ocean distance (0..1; 1 => ridge boost <= 2x sea distance).

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

type RiverPath = {
	points: Vec2[];
	depth: number;
};

type RiverTrace = {
	edges: number[];
	faces: number[];
	vertices: number[];
	maxElevation: number;
	length: number;
	startFace: number;
	depth?: number;
	points?: Vec2[];
};

type RiverTraceResult = {
	traces: RiverTrace[];
	riverEdgeMask: boolean[];
};

type TerrainConfig = {
	width: number;
	height: number;
};

const MAX_LAND_ELEVATION = 32;

export type TerrainBasegenResult = {
	mesh: MeshGraph;
	baseCells: Vec2[][];
	isLand: boolean[];
	oceanWater: boolean[];
};

export type TerrainMeshState = {
	mesh: MeshGraph;
	baseCells: Vec2[][];
};

export type TerrainWaterState = {
	isLand: boolean[];
	oceanWater: boolean[];
	waterElevation: number[];
	landDistance: number[];
	landFaces: number[];
	maxLandDistance: number;
	hasLand: boolean;
	hasWater: boolean;
};

export type TerrainMountainState = {
	landElevation: number[];
};

export type TerrainRiverState = {
	traces: RiverTrace[];
	riverEdgeMask: boolean[];
	paths: RiverPath[];
};

export type TerrainRefineState = {
	refinedGeometry: RefinedGeometry;
};

export type TerrainRefineResult = {
	refinedGeometry: RefinedGeometry;
	rivers: RiverPath[];
};

export function generateMesh(
	config: TerrainConfig,
	controls: TerrainControls,
	random: () => number
): TerrainMeshState {
	const padding = 0;
	const sites = generatePoissonSites(config, controls.spacing, padding, random);
	const baseCells: Vec2[][] = new Array(sites.length);
	sites.forEach((site, index) => {
		baseCells[index] = buildVoronoiCell(config, site, sites);
	});
	const mesh = buildMeshGraph(sites, baseCells);
	return { mesh, baseCells };
}

export function generateWater(
	config: TerrainConfig,
	mesh: MeshGraph,
	baseCells: Vec2[][],
	controls: TerrainControls,
	random: () => number
): TerrainWaterState {
	const width = config.width;
	const height = config.height;
	const normalizedWaterLevel = clamp(controls.waterLevel, -40, 40) / 40;
	const normalizedRoughness = clamp(controls.waterRoughness, 0, 100) / 100;
	const clampedNoiseScale = clamp(controls.waterNoiseScale, 2, 60);
	const clampedNoiseStrength = clamp(controls.waterNoiseStrength, 0, 1);
	const clampedNoiseOctaves = Math.round(clamp(controls.waterNoiseOctaves, 1, 6));
	const clampedWarpScale = clamp(controls.waterWarpScale, 2, 40);
	const clampedWarpStrength = clamp(controls.waterWarpStrength, 0, 0.8);
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
		const cell = baseCells[centerIndex];
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

	const landFaces: number[] = [];
	const landDistance = new Array<number>(faceCount).fill(-1);
	const coastQueue: number[] = [];

	if (hasWater && hasLand) {
		mesh.faces.forEach((face) => {
			if (!isLand[face.index]) {
				return;
			}
			const isShore = face.adjacentFaces.some((neighborIndex) => !isLand[neighborIndex]);
			if (isShore) {
				landDistance[face.index] = 0;
				coastQueue.push(face.index);
			}
		});

		for (let q = 0; q < coastQueue.length; q += 1) {
			const face = mesh.faces[coastQueue[q]];
			const currentDistance = landDistance[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (!isLand[neighborIndex] || landDistance[neighborIndex] >= 0) {
					continue;
				}
				landDistance[neighborIndex] = currentDistance + 1;
				coastQueue.push(neighborIndex);
			}
		}
	}

	let maxLandDistance = 0;
	mesh.faces.forEach((face) => {
		if (isLand[face.index]) {
			landFaces.push(face.index);
			maxLandDistance = Math.max(maxLandDistance, landDistance[face.index]);
		}
	});

	const oceanWater = getOceanWaterFaces(mesh, baseCells, isLand, config);
	const waterElevation = new Array<number>(faceCount).fill(Number.NaN);
	const waterQueue: number[] = [];

	if (hasWater) {
		for (let i = 0; i < mesh.faces.length; i += 1) {
			if (isLand[i]) {
				continue;
			}
			if (!oceanWater[i]) {
				waterElevation[i] = 0;
			}
		}
	}

	if (hasWater && hasLand) {
		mesh.faces.forEach((face) => {
			if (isLand[face.index] || !oceanWater[face.index]) {
				return;
			}
			const isShoreWater = face.adjacentFaces.some((neighborIndex) => isLand[neighborIndex]);
			if (isShoreWater) {
				waterElevation[face.index] = 1;
				waterQueue.push(face.index);
			}
		});

		for (let q = 0; q < waterQueue.length; q += 1) {
			const face = mesh.faces[waterQueue[q]];
			const currentElevation = waterElevation[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (isLand[neighborIndex] || !oceanWater[neighborIndex]) {
					continue;
				}
				if (Number.isNaN(waterElevation[neighborIndex])) {
					waterElevation[neighborIndex] = currentElevation - 1;
					waterQueue.push(neighborIndex);
				}
			}
		}
	}

	return {
		isLand,
		oceanWater,
		waterElevation,
		landDistance,
		landFaces,
		maxLandDistance,
		hasLand,
		hasWater,
	};
}

export function applyMountains(
	mesh: MeshGraph,
	waterState: TerrainWaterState,
	controls: TerrainControls,
	random: () => number
): TerrainMountainState {
	const faceCount = mesh.faces.length;
	const maxElevation = MAX_LAND_ELEVATION;
	const redistributionExponent = 1.6;
	const landReliefClamped = clamp(controls.landRelief, 0, 1);
	const ridgeStrengthClamped = clamp(controls.ridgeStrength, 0, 1);
	const ridgeCountClamped = Math.round(clamp(controls.ridgeCount, 1, 10));
	const plateauStrengthClamped = clamp(controls.plateauStrength, 0, 1);
	const ridgeDistributionClamped = clamp(controls.ridgeDistribution, 0, 1);
	const ridgeSeparationClamped = clamp(controls.ridgeSeparation, 0, 1);
	const ridgeContinuityClamped = clamp(controls.ridgeContinuity, 0, 1);
	const ridgeContinuityThresholdClamped = clamp(controls.ridgeContinuityThreshold, 0, 1);
	const oceanPeakClampClamped = clamp(controls.oceanPeakClamp, 0, 1);
	const ridgeOceanClampClamped = clamp(controls.ridgeOceanClamp, 0, 1);
	const ridgeWidthClamped = clamp(controls.ridgeWidth, 0, 1);
	const lowlandMax = 10;

	const { isLand, landDistance, landFaces, maxLandDistance, waterElevation, hasLand, hasWater } = waterState;
	const landBaseLevel = new Array<number>(faceCount).fill(1);

	if (hasLand) {
		if (hasWater && maxLandDistance > 0) {
			for (let i = 0; i < landFaces.length; i += 1) {
				const faceIndex = landFaces[i];
				const dist = Math.max(0, landDistance[faceIndex]);
				const base = dist / maxLandDistance;
				const redistributed = Math.pow(base, redistributionExponent);
				const scaled = redistributed * landReliefClamped;
				landBaseLevel[faceIndex] = clamp(
					1 + Math.floor(scaled * (maxElevation - 1)),
					1,
					maxElevation
				);
			}
		} else {
			const uniformLevel = clamp(1 + Math.floor(landReliefClamped * (maxElevation - 1)), 1, maxElevation);
			for (let i = 0; i < landFaces.length; i += 1) {
				landBaseLevel[landFaces[i]] = uniformLevel;
			}
		}
	}

	const ridgeBoost = new Array<number>(faceCount).fill(0);
	if (hasLand && ridgeStrengthClamped > 0 && ridgeCountClamped > 0) {
		const ridgeSeeds = pickRidgeSeedsFromLocalMaxima(
			mesh,
			isLand,
			landFaces,
			landDistance,
			ridgeCountClamped,
			ridgeSeparationClamped,
			random
		);
		const ridgeDistance = new Array<number>(faceCount).fill(-1);
		const ridgeQueue: number[] = [];
		ridgeSeeds.forEach((seed) => {
			ridgeDistance[seed] = 0;
			ridgeQueue.push(seed);
		});
		for (let q = 0; q < ridgeQueue.length; q += 1) {
			const face = mesh.faces[ridgeQueue[q]];
			const currentDistance = ridgeDistance[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (!isLand[neighborIndex] || ridgeDistance[neighborIndex] >= 0) {
					continue;
				}
				ridgeDistance[neighborIndex] = currentDistance + 1;
				ridgeQueue.push(neighborIndex);
			}
		}

		const ridgeRadiusScale =
			lerp(0.25, 1.1, ridgeDistributionClamped) * lerp(1, 0.75, ridgeStrengthClamped);
		const ridgeRadius =
			maxLandDistance > 0
				? Math.max(2, Math.round(maxLandDistance * ridgeRadiusScale))
				: Math.max(2, Math.round(Math.sqrt(landFaces.length) * (0.25 + 0.9 * ridgeDistributionClamped)));
		const ridgeExponent = lerp(2.2, 3.2, ridgeStrengthClamped) * lerp(1, 0.6, ridgeDistributionClamped);
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const dist = ridgeDistance[faceIndex];
			if (dist < 0) {
				continue;
			}
			const ridgeT = 1 - dist / ridgeRadius;
			if (ridgeT <= 0) {
				continue;
			}
			const ridgeShaped = Math.pow(ridgeT, ridgeExponent);
			const coastT = maxLandDistance > 0 ? 1 - landDistance[faceIndex] / maxLandDistance : 0;
			const coastBoost = lerp(1, 1 + 0.7 * coastT, ridgeDistributionClamped);
			const boost = Math.round(
				ridgeShaped *
					coastBoost *
					ridgeStrengthClamped *
					(0.6 + 0.4 * landReliefClamped) *
					(maxElevation - 1)
			);
			ridgeBoost[faceIndex] = clamp(boost, 0, maxElevation - 1);
		}

		if (ridgeContinuityClamped > 0 && ridgeSeeds.length > 1) {
			connectRidgeSeeds(
				mesh,
				isLand,
				ridgeSeeds,
				ridgeBoost,
				ridgeStrengthClamped,
				ridgeContinuityClamped,
				ridgeWidthClamped,
				ridgeDistributionClamped,
				ridgeContinuityThresholdClamped,
				maxElevation,
				maxLandDistance,
				landFaces.length
			);
		}
	}

	if (hasLand && hasWater && ridgeOceanClampClamped > 0) {
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const dist = Math.max(0, landDistance[faceIndex]);
			const cap = clamp(
				Math.round(lerp(maxElevation - 1, dist * 2, ridgeOceanClampClamped)),
				0,
				maxElevation - 1
			);
			if (ridgeBoost[faceIndex] > cap) {
				ridgeBoost[faceIndex] = cap;
			}
		}
	}

	const finalLandElevation = new Array<number>(faceCount).fill(0);
	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		const base = landBaseLevel[faceIndex];
		const boost = ridgeBoost[faceIndex];
		finalLandElevation[faceIndex] = clamp(base + boost, 1, maxElevation);
	}

	if (hasLand && plateauStrengthClamped > 0) {
		const smoothed = new Array<number>(faceCount).fill(0);
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const current = finalLandElevation[faceIndex];
			if (current <= 0 || current > lowlandMax) {
				smoothed[faceIndex] = current;
				continue;
			}
			let sum = current;
			let count = 1;
			const face = mesh.faces[faceIndex];
			for (let j = 0; j < face.adjacentFaces.length; j += 1) {
				const neighbor = face.adjacentFaces[j];
				const neighborElevation = finalLandElevation[neighbor];
				if (!isLand[neighbor] || neighborElevation <= 0 || neighborElevation > lowlandMax) {
					continue;
				}
				sum += neighborElevation;
				count += 1;
			}
			const avg = sum / count;
			const blended = lerp(current, avg, plateauStrengthClamped);
			smoothed[faceIndex] = clamp(Math.round(blended), 1, maxElevation);
		}
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			finalLandElevation[faceIndex] = smoothed[faceIndex] || finalLandElevation[faceIndex];
		}
	}

	if (hasLand && hasWater && oceanPeakClampClamped > 0) {
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const dist = Math.max(0, landDistance[faceIndex]);
			const cap = clamp(Math.round(lerp(maxElevation, dist * 2, oceanPeakClampClamped)), 1, maxElevation);
			finalLandElevation[faceIndex] = Math.min(finalLandElevation[faceIndex], cap);
		}
	}

	mesh.faces.forEach((face) => {
		if (isLand[face.index]) {
			face.elevation = finalLandElevation[face.index];
			return;
		}
		if (!hasLand && hasWater) {
			face.elevation = 0;
			return;
		}
		const elevation = waterElevation[face.index];
		face.elevation = Number.isNaN(elevation) ? 0 : elevation;
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

	return { landElevation: finalLandElevation };
}

export function terrainBasegen(
	config: TerrainConfig,
	controls: TerrainControls,
	random: () => number
): TerrainBasegenResult {
	const meshState = generateMesh(config, controls, random);
	const waterState = generateWater(config, meshState.mesh, meshState.baseCells, controls, random);
	applyMountains(meshState.mesh, waterState, controls, random);
	return {
		mesh: meshState.mesh,
		baseCells: meshState.baseCells,
		isLand: waterState.isLand,
		oceanWater: waterState.oceanWater,
	};
}

export function terrainRefine(
	mesh: MeshGraph,
	isLand: boolean[],
	controls: TerrainControls,
	intermediateRandom: () => number,
	riverRandom: () => number,
	oceanWater: boolean[],
	riverTraces?: RiverTrace[]
): TerrainRefineResult {
	const refinedGeometry = buildRefinedGeometry(mesh, isLand, controls, intermediateRandom);
	const rivers =
		riverTraces && riverTraces.length > 0
			? materializeRiverPaths(mesh, refinedGeometry, controls, riverTraces)
			: buildRivers(mesh, refinedGeometry, controls, riverRandom, isLand, oceanWater);
	return { refinedGeometry, rivers };
}

export function renderTerrain(
	config: TerrainConfig,
	controls: TerrainControls,
	terrainLayer: any,
	base: TerrainBasegenResult,
	provinceGraph: ProvinceGraph,
	refined: TerrainRefineResult
): void {
	if (!terrainLayer)
	{
		return;
	}

	const baseLayer = ensureBaseLayer(terrainLayer);
	const riverLayer = ensureRiverLayer(terrainLayer);
	const provinceLayer = ensureProvinceLayer(terrainLayer);
	clearLayerChildren(baseLayer);
	clearLayerChildren(riverLayer);
	clearLayerChildren(provinceLayer);

	const waterTint = new Graphics();
	waterTint.rect(0, 0, config.width, config.height);
	waterTint.fill({ color: 0x0d1a2e, alpha: 0.18 });
	baseLayer.addChild(waterTint);

	const seed = controls.seed >>> 0;
	const { mesh, baseCells } = base;
	const { refinedGeometry, rivers } = refined;
	const maxLandElevation = MAX_LAND_ELEVATION;

	mesh.faces.forEach((face) => {
		const refinedCell = refinedGeometry.refinedCells[face.index];
		const baseCell = baseCells[face.index];
		const cell = refinedCell && refinedCell.length >= 3 ? refinedCell : baseCell;
		if (!cell || cell.length < 3) {
			return;
		}
		let fillColor = 0x3f8a3f;
		let fillAlpha = 0.86;

		const isLandFace = provinceGraph.isLand[face.index];
		if (!isLandFace) {
			const maxDepth = 6;
			const depthT = clamp((1 - face.elevation) / maxDepth, 0, 1);
			const shallow = 0x2f5f89;
			const deep = 0x0f2438;
			fillColor = lerpColor(shallow, deep, depthT);
			fillAlpha = 1;
		} else {
			fillColor = landElevationToColor(face.elevation, maxLandElevation);
			fillAlpha = 0.86;
		}

		const terrain = new Graphics();
		terrain.poly(flattenPolygon(cell), true);
		terrain.fill({ color: fillColor, alpha: fillAlpha });
		baseLayer.addChild(terrain);

		const isShoreWater =
			!isLandFace &&
			face.adjacentFaces.some((neighborIndex) => provinceGraph.isLand[neighborIndex]);
		if (isShoreWater) {
			const strokes = new Graphics();
			const strokeMask = new Graphics();
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

	renderRivers(riverLayer, rivers, controls);
	renderProvinceBorders(
		mesh,
		refinedGeometry,
		baseCells,
		provinceGraph,
		config,
		controls,
		provinceLayer
	);
	terrainLayer[PROVINCE_CACHE_KEY] = {
		mesh,
		refinedGeometry,
		baseCells,
		provinceGraph,
		config,
	} satisfies ProvinceRenderCache;
}

export function drawVoronoiTerrain(
	config: TerrainConfig,
	controls: TerrainControls,
	terrainLayer: any
): void {
	if (!terrainLayer)
	{
		return;
	}
	const seed = controls.seed >>> 0;
	const meshRandom = createStepRng(seed, STEP_SEEDS.mesh);
	const waterRandom = createStepRng(seed, STEP_SEEDS.water);
	const mountainRandom = createStepRng(seed, STEP_SEEDS.mountain);
	const riverRandom = createStepRng(seed, STEP_SEEDS.river);
	const provinceRandom = createStepRng(seed, STEP_SEEDS.province);
	const intermediateSeed = controls.intermediateSeed >>> 0;
	const intermediateRandom = createRng(intermediateSeed);

	const meshState = generateMesh(config, controls, meshRandom);
	const waterState = generateWater(config, meshState.mesh, meshState.baseCells, controls, waterRandom);
	applyMountains(meshState.mesh, waterState, controls, mountainRandom);
	const riverTraceResult = buildRiverTraces(
		meshState.mesh,
		controls,
		riverRandom,
		waterState.isLand,
		waterState.oceanWater
	);
	const provinceResult = basegenPolitical(
		meshState.mesh,
		controls,
		provinceRandom,
		waterState.isLand,
		riverTraceResult.riverEdgeMask
	);
	const refinedGeometry = buildRefinedGeometry(
		meshState.mesh,
		waterState.isLand,
		controls,
		intermediateRandom
	);
	const rivers = materializeRiverPaths(meshState.mesh, refinedGeometry, controls, riverTraceResult.traces);
	const base = {
		mesh: meshState.mesh,
		baseCells: meshState.baseCells,
		isLand: waterState.isLand,
		oceanWater: waterState.oceanWater,
	};
	const refined = { refinedGeometry, rivers };
	renderTerrain(config, controls, terrainLayer, base, provinceResult, refined);
}

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
	isLand: boolean[],
	controls: TerrainControls,
	random: () => number
): RefinedGeometry {
	const { edgePolylines, insertedPoints } = buildEdgePolylines(mesh, isLand, controls, random);
	const refinedCells = buildRefinedCells(mesh, edgePolylines);
	return { edgePolylines, refinedCells, insertedPoints };
}

function buildEdgePolylines(
	mesh: MeshGraph,
	isLand: boolean[],
	controls: TerrainControls,
	random: () => number
): { edgePolylines: EdgePolyline[]; insertedPoints: Vec2[] } {
	const edgePolylines: EdgePolyline[] = new Array(mesh.edges.length);
	const insertedPoints: Vec2[] = [];
	const baseIterations = Math.max(0, Math.round(controls.intermediateMaxIterations));
	const baseRelMagnitude = controls.intermediateRelMagnitude;
	const baseAbsMagnitude = controls.intermediateAbsMagnitude;

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
		const sameLevelWater = !isLand[faceA] && !isLand[faceB] && face0.elevation === face1.elevation;
		if (sameLevelWater) {
			edgePolylines[edgeIndex] = [v0, v1];
			continue;
		}
		const isLandA = isLand[faceA];
		const isLandB = isLand[faceB];
		const sameElevation = face0.elevation === face1.elevation;
		if (sameElevation && isLandA === isLandB) {
			edgePolylines[edgeIndex] = [v0, v1];
			continue;
		}
		const noiseScale = 1;
		const iterationLimit = Math.max(0, Math.round(baseIterations));

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

type RiverCandidate = {
	edgeIndex: number;
	nextVertex: number;
	nextFace: number;
	nextElevation: number;
};

function buildRivers(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	random: () => number,
	isLand: boolean[],
	oceanWater: boolean[]
): RiverPath[] {
	const traceResult = buildRiverTraces(mesh, controls, random, isLand, oceanWater);
	if (traceResult.traces.length === 0) {
		return [];
	}
	return materializeRiverPaths(mesh, refinedGeometry, controls, traceResult.traces);
}

export function buildRiverTraces(
	mesh: MeshGraph,
	controls: TerrainControls,
	random: () => number,
	isLand: boolean[],
	oceanWater: boolean[]
): RiverTraceResult {
	const riverEdgeMask = new Array<boolean>(mesh.edges.length).fill(false);
	const riverDensity = clamp(controls.riverDensity ?? 0, 0, 2);
	const riverBranchChance = clamp(controls.riverBranchChance ?? 0.25, 0, 1);
	const riverClimbChance = clamp(controls.riverClimbChance ?? 0.35, 0, 1);
	const riverSeed = (controls.seed ^ 0x9e3779b9) >>> 0;
	if (riverDensity <= 0) {
		return { traces: [], riverEdgeMask };
	}

	const vertexHasLand = new Array<boolean>(mesh.vertices.length).fill(false);
	const vertexHasWater = new Array<boolean>(mesh.vertices.length).fill(false);
	mesh.vertices.forEach((vertex) => {
		let hasLand = false;
		let hasWater = false;
		for (let i = 0; i < vertex.faces.length; i += 1) {
			const faceIndex = vertex.faces[i];
			if (isLand[faceIndex]) {
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
		return { traces: [], riverEdgeMask };
	}

	const isShorelineFace = new Array<boolean>(mesh.faces.length).fill(false);
	for (let i = 0; i < mesh.faces.length; i += 1) {
		const face = mesh.faces[i];
		if (isLand[face.index] && isFaceShoreline(mesh, isLand, face.index)) {
			isShorelineFace[face.index] = true;
		}
	}

	const shorelineVerticesByFace: number[][] = new Array(mesh.faces.length);
	for (let i = 0; i < shorelineVerticesByFace.length; i += 1) {
		shorelineVerticesByFace[i] = [];
	}
	for (let i = 0; i < shorelineVertices.length; i += 1) {
		const vertexIndex = shorelineVertices[i];
		const vertex = mesh.vertices[vertexIndex];
		for (let j = 0; j < vertex.faces.length; j += 1) {
			const faceIndex = vertex.faces[j];
			if (isShorelineFace[faceIndex]) {
				shorelineVerticesByFace[faceIndex].push(vertexIndex);
			}
		}
	}

	const shorelineFaces: number[] = [];
	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (isShorelineFace[i] && shorelineVerticesByFace[i].length > 0) {
			shorelineFaces.push(i);
		}
	}
	if (shorelineFaces.length === 0) {
		return { traces: [], riverEdgeMask };
	}

	const inlandWaterSize = new Array<number>(mesh.faces.length).fill(0);
	const visitedWater = new Array<boolean>(mesh.faces.length).fill(false);
	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (isLand[i] || oceanWater[i] || visitedWater[i]) {
			continue;
		}
		const stack = [i];
		const component: number[] = [];
		visitedWater[i] = true;
		while (stack.length > 0) {
			const faceIndex = stack.pop() as number;
			component.push(faceIndex);
			const face = mesh.faces[faceIndex];
			for (let j = 0; j < face.adjacentFaces.length; j += 1) {
				const neighbor = face.adjacentFaces[j];
				if (isLand[neighbor] || oceanWater[neighbor] || visitedWater[neighbor]) {
					continue;
				}
				visitedWater[neighbor] = true;
				stack.push(neighbor);
			}
		}
		const size = component.length;
		for (let j = 0; j < component.length; j += 1) {
			inlandWaterSize[component[j]] = size;
		}
	}

	const minInlandWaterFaces = 5;
	let eligibleStartFaces = shorelineFaces.filter((faceIndex) => {
		const face = mesh.faces[faceIndex];
		let hasOcean = false;
		let maxInland = 0;
		for (let j = 0; j < face.adjacentFaces.length; j += 1) {
			const neighbor = face.adjacentFaces[j];
			if (isLand[neighbor]) {
				continue;
			}
			if (oceanWater[neighbor]) {
				hasOcean = true;
				break;
			}
			maxInland = Math.max(maxInland, inlandWaterSize[neighbor]);
		}
		if (hasOcean) {
			return true;
		}
		return maxInland >= minInlandWaterFaces;
	});
	if (eligibleStartFaces.length === 0) {
		eligibleStartFaces = shorelineFaces.slice();
	}

	const coastLand = new Array<boolean>(mesh.faces.length).fill(false);
	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (!isLand[i]) {
			continue;
		}
		const face = mesh.faces[i];
		const touchesOcean = face.adjacentFaces.some(
			(neighborIndex) => !isLand[neighborIndex] && oceanWater[neighborIndex]
		);
		if (touchesOcean) {
			coastLand[i] = true;
		}
	}

	const baseCount = Math.max(1, Math.round(eligibleStartFaces.length / 5));
	const desiredCount = Math.round(baseCount * riverDensity);
	if (desiredCount <= 0) {
		return { traces: [], riverEdgeMask };
	}

	const startFaces = pickRandomShorelineFaces(eligibleStartFaces, desiredCount, random);
	if (startFaces.length === 0) {
		return { traces: [], riverEdgeMask };
	}

	const maxSteps = clamp(Math.round(mesh.vertices.length * 0.15), 40, 260);
	const candidates: RiverTrace[] = [];
	const attemptedFaces = new Set<number>();
	const tryStartFace = (startFace: number): void => {
		if (attemptedFaces.has(startFace) || candidates.length >= desiredCount) {
			return;
		}
		attemptedFaces.add(startFace);
		const startVertices = shorelineVerticesByFace[startFace];
		if (!startVertices || startVertices.length === 0) {
			return;
		}
		const validStartVertices: number[] = [];
		for (let v = 0; v < startVertices.length; v += 1) {
			const candidateVertex = startVertices[v];
			if (hasValidRiverStart(mesh, isLand, coastLand, candidateVertex, startFace)) {
				validStartVertices.push(candidateVertex);
			}
		}
		if (validStartVertices.length === 0) {
			return;
		}
		const startVertex =
			validStartVertices[Math.floor(random() * validStartVertices.length)];
		const trace = traceRiverPathRaw(
			mesh,
			riverClimbChance,
			false,
			isLand,
			coastLand,
			coastLand[startFace],
			coastLand[startFace] ? false : true,
			random,
			startVertex,
			startFace,
			maxSteps,
			new Set<number>(),
			new Set<number>()
		);
		if (trace && trace.edges.length > 0) {
			candidates.push(trace);
		}
	};

	for (let i = 0; i < startFaces.length; i += 1) {
		tryStartFace(startFaces[i]);
	}

	if (candidates.length < desiredCount && eligibleStartFaces.length > attemptedFaces.size) {
		const remainingFaces = eligibleStartFaces.filter((faceIndex) => !attemptedFaces.has(faceIndex));
		for (let s = remainingFaces.length - 1; s > 0; s -= 1) {
			const swapIndex = Math.floor(random() * (s + 1));
			[remainingFaces[s], remainingFaces[swapIndex]] = [
				remainingFaces[swapIndex],
				remainingFaces[s],
			];
		}
		for (let i = 0; i < remainingFaces.length; i += 1) {
			if (candidates.length >= desiredCount) {
				break;
			}
			tryStartFace(remainingFaces[i]);
		}
	}

	if (candidates.length === 0) {
		return { traces: [], riverEdgeMask };
	}

	const ranked = candidates.slice().sort((a, b) => {
		if (b.length !== a.length) {
			return b.length - a.length;
		}
		if (b.maxElevation !== a.maxElevation) {
			return b.maxElevation - a.maxElevation;
		}
		const aTie = hash2D(a.startFace, 991, riverSeed);
		const bTie = hash2D(b.startFace, 991, riverSeed);
		return aTie - bTie;
	});

	const mainCount = Math.max(1, Math.round(ranked.length * 0.5));
	const usedEdges = new Set<number>();
	const branchFaces = new Set<number>();
	const mainTraces: RiverTrace[] = [];
	const branchMinRatio = 0.35;

	for (let i = 0; i < ranked.length && mainTraces.length < mainCount; i += 1) {
		const trace = ranked[i];
		let overlaps = false;
		for (let e = 0; e < trace.edges.length; e += 1) {
			if (usedEdges.has(trace.edges[e])) {
				overlaps = true;
				break;
			}
		}
		if (overlaps) {
			continue;
		}
		mainTraces.push(trace);
		for (let e = 0; e < trace.edges.length; e += 1) {
			usedEdges.add(trace.edges[e]);
		}
	}

	if (mainTraces.length === 0) {
		return { traces: [], riverEdgeMask };
	}

	const traces: RiverTrace[] = [];
	for (let i = 0; i < mainTraces.length; i += 1) {
		const trace = mainTraces[i];
		traces.push({ ...trace, depth: 0 });
		for (let e = 0; e < trace.edges.length; e += 1) {
			riverEdgeMask[trace.edges[e]] = true;
		}
	}

	for (let i = 0; i < mainTraces.length; i += 1) {
		const main = mainTraces[i];
		const vertexDistances = computeTraceVertexDistancesRaw(main, mesh);
		const peakDistance = computeTracePeakDistance(main, vertexDistances, mesh);
		const vertexCount = main.vertices.length;
		for (let j = 1; j < vertexCount - 1; j += 1) {
			if (random() >= riverBranchChance) {
				continue;
			}
			const startVertex = main.vertices[j];
			const candidateFaces = mesh.vertices[startVertex].faces.filter(
				(faceIndex) => isLand[faceIndex]
			);
			if (candidateFaces.length === 0) {
				continue;
			}
			for (let s = candidateFaces.length - 1; s > 0; s -= 1) {
				const swapIndex = Math.floor(random() * (s + 1));
				[candidateFaces[s], candidateFaces[swapIndex]] = [
					candidateFaces[swapIndex],
					candidateFaces[s],
				];
			}

			let branchTrace: RiverTrace | null = null;
			for (let s = 0; s < candidateFaces.length; s += 1) {
				const startFace = candidateFaces[s];
				const attempt = traceRiverPathRaw(
					mesh,
					riverClimbChance,
					true,
					isLand,
					coastLand,
					coastLand[startFace],
					coastLand[startFace] ? false : true,
					random,
					startVertex,
					startFace,
					maxSteps,
					usedEdges,
					branchFaces
				);
				if (attempt && attempt.edges.length > 0) {
					branchTrace = attempt;
					break;
				}
			}
			if (!branchTrace) {
				continue;
			}
			const branchDistance = vertexDistances[j] ?? 0;
			const distToPeak = Math.abs(peakDistance - branchDistance);
			if (distToPeak > 0) {
				const minLength = distToPeak * branchMinRatio;
				if (branchTrace.length < minLength) {
					continue;
				}
			}
			let overlaps = false;
			for (let e = 0; e < branchTrace.edges.length; e += 1) {
				if (usedEdges.has(branchTrace.edges[e])) {
					overlaps = true;
					break;
				}
			}
			if (overlaps) {
				continue;
			}
			traces.push({ ...branchTrace, depth: 1 });
			for (let e = 0; e < branchTrace.edges.length; e += 1) {
				usedEdges.add(branchTrace.edges[e]);
				riverEdgeMask[branchTrace.edges[e]] = true;
			}
			for (let f = 0; f < branchTrace.faces.length; f += 1) {
				branchFaces.add(branchTrace.faces[f]);
			}
		}
	}

	return { traces, riverEdgeMask };
}

export function materializeRiverPaths(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	traces: RiverTrace[]
): RiverPath[] {
	if (traces.length === 0) {
		return [];
	}
	const riverSeed = (controls.seed ^ 0x9e3779b9) >>> 0;
	const riverPolylineCache = new Map<number, Vec2[]>();
	const paths: RiverPath[] = [];
	for (let i = 0; i < traces.length; i += 1) {
		const trace = traces[i];
		const points: Vec2[] = [];
		for (let e = 0; e < trace.edges.length; e += 1) {
			const edgeIndex = trace.edges[e];
			const fromVertex = trace.vertices[e];
			const toVertex = trace.vertices[e + 1];
			let segment = collectRiverEdgePolyline(
				mesh,
				refinedGeometry,
				controls,
				riverSeed,
				riverPolylineCache,
				edgeIndex,
				fromVertex,
				toVertex
			);
			if (segment.length < 2) {
				const fromPoint = mesh.vertices[fromVertex]?.point;
				const toPoint = mesh.vertices[toVertex]?.point;
				if (fromPoint && toPoint) {
					segment = [fromPoint, toPoint];
				}
			}
			if (segment.length >= 2) {
				appendPath(points, segment);
			}
		}
		if (points.length >= 2) {
			paths.push({ points, depth: trace.depth ?? 0 });
		}
	}
	return paths;
}

function isFaceShoreline(mesh: MeshGraph, isLand: boolean[], faceIndex: number): boolean {
	const face = mesh.faces[faceIndex];
	for (let i = 0; i < face.adjacentFaces.length; i += 1) {
		const neighbor = face.adjacentFaces[i];
		if (!isLand[neighbor]) {
			return true;
		}
	}
	return false;
}

function hasValidRiverStart(
	mesh: MeshGraph,
	isLand: boolean[],
	coastLand: boolean[],
	vertexIndex: number,
	startFace: number
): boolean {
	const currentElevation = mesh.faces[startFace].elevation;
	if (!isLand[startFace]) {
		return false;
	}
	const visitedFaces = new Set<number>([startFace]);
	const leftCoast = !coastLand[startFace];
	const enforceCoastBlock = coastLand[startFace];
	const candidates = collectRiverCandidates(
		mesh,
		isLand,
		coastLand,
		enforceCoastBlock,
		leftCoast,
		new Set<number>(),
		visitedFaces,
		vertexIndex,
		startFace,
		currentElevation
	);
	if (candidates.length === 0) {
		return false;
	}
	let hasHigher = false;
	let hasFlat = false;
	for (let i = 0; i < candidates.length; i += 1) {
		const elevation = candidates[i].nextElevation;
		if (elevation > currentElevation) {
			hasHigher = true;
			break;
		}
		if (elevation === currentElevation) {
			hasFlat = true;
		}
	}
	return hasHigher || hasFlat;
}

function pickRandomShorelineFaces(
	faces: number[],
	desiredCount: number,
	random: () => number
): number[] {
	const pool = faces.slice();
	const count = Math.min(desiredCount, pool.length);
	const picks: number[] = [];
	for (let i = 0; i < count; i += 1) {
		const idx = Math.floor(random() * pool.length);
		const pick = pool[idx];
		picks.push(pick);
		pool[idx] = pool[pool.length - 1];
		pool.pop();
		if (pool.length === 0) {
			break;
		}
	}
	return picks;
}

function computeTraceVertexDistances(
	trace: RiverTrace,
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	riverSeed: number,
	riverPolylineCache: Map<number, Vec2[]>
): number[] {
	const distances: number[] = [0];
	let traveled = 0;
	for (let i = 0; i < trace.edges.length; i += 1) {
		const fromVertex = trace.vertices[i];
		const toVertex = trace.vertices[i + 1];
		const segment = collectRiverEdgePolyline(
			mesh,
			refinedGeometry,
			controls,
			riverSeed,
			riverPolylineCache,
			trace.edges[i],
			fromVertex,
			toVertex
		);
		const segLength =
			segment.length >= 2 ? computePathLength(segment) : vec2Len(vec2Sub(
				mesh.vertices[toVertex].point,
				mesh.vertices[fromVertex].point
			));
		traveled += Math.max(0, segLength);
		distances.push(traveled);
	}
	return distances;
}

function computeTraceVertexDistancesRaw(trace: RiverTrace, mesh: MeshGraph): number[] {
	const distances: number[] = [0];
	let traveled = 0;
	for (let i = 0; i < trace.edges.length; i += 1) {
		const fromVertex = trace.vertices[i];
		const toVertex = trace.vertices[i + 1];
		const fromPoint = mesh.vertices[fromVertex]?.point;
		const toPoint = mesh.vertices[toVertex]?.point;
		if (fromPoint && toPoint) {
			traveled += vec2Len(vec2Sub(toPoint, fromPoint));
		}
		distances.push(traveled);
	}
	return distances;
}

function computeTracePeakDistance(
	trace: RiverTrace,
	vertexDistances: number[],
	mesh: MeshGraph
): number {
	let peakElevation = -Infinity;
	let peakDistance = 0;
	for (let i = 0; i < trace.faces.length; i += 1) {
		const faceIndex = trace.faces[i];
		const elevation = mesh.faces[faceIndex].elevation;
		const distance = vertexDistances[i] ?? 0;
		if (elevation > peakElevation || (elevation === peakElevation && distance > peakDistance)) {
			peakElevation = elevation;
			peakDistance = distance;
		}
	}
	return peakDistance;
}

function collectRiverEdgeLine(
	mesh: MeshGraph,
	edgeIndex: number,
	fromVertex: number,
	toVertex: number
): Vec2[] {
	const edge = mesh.edges[edgeIndex];
	if (
		!edge ||
		!(
			(edge.vertices[0] === fromVertex && edge.vertices[1] === toVertex) ||
			(edge.vertices[1] === fromVertex && edge.vertices[0] === toVertex)
		)
	) {
		return [];
	}
	const v0 = mesh.vertices[edge.vertices[0]].point;
	const v1 = mesh.vertices[edge.vertices[1]].point;
	return edge.vertices[0] === fromVertex ? [v0, v1] : [v1, v0];
}

function traceRiverPathRaw(
	mesh: MeshGraph,
	riverClimbChance: number,
	allowInitialDrop: boolean,
	isLand: boolean[],
	coastLand: boolean[],
	enforceCoastBlock: boolean,
	leftCoast: boolean,
	random: () => number,
	startVertex: number,
	startFace: number,
	maxSteps: number,
	blockedEdges: Set<number>,
	blockedFaces: Set<number>
): RiverTrace | null {
	let currentVertex = startVertex;
	let currentFace = startFace;
	let currentElevation = mesh.faces[currentFace].elevation;
	if (!isLand[startFace]) {
		return null;
	}
	const points: Vec2[] = [];
	const edges: number[] = [];
	const faces: number[] = [startFace];
	const vertices: number[] = [startVertex];
	const visitedFaces = new Set<number>(blockedFaces);
	visitedFaces.add(startFace);
	let maxElevation = currentElevation;
	let flatSteps = 0;
	let steps = 0;

	while (steps < maxSteps) {
		const minElevation = allowInitialDrop && steps === 0 ? 1 : currentElevation;
		const candidates = collectRiverCandidates(
			mesh,
			isLand,
			coastLand,
			enforceCoastBlock,
			leftCoast,
			blockedEdges,
			visitedFaces,
			currentVertex,
			currentFace,
			minElevation
		);
		if (candidates.length === 0) {
			break;
		}
		const higherCandidates = candidates.filter(
			(candidate) => candidate.nextElevation > currentElevation
		);
		const equalCandidates = candidates.filter(
			(candidate) => candidate.nextElevation === currentElevation
		);
		const lowerCandidates =
			allowInitialDrop && steps === 0
				? candidates.filter((candidate) => candidate.nextElevation < currentElevation)
				: [];
		let usableCandidates: RiverCandidate[] = [];
		if (higherCandidates.length > 0) {
			usableCandidates = higherCandidates;
		} else if (equalCandidates.length > 0) {
			const canContinueFlat =
				flatSteps < 3 || (riverClimbChance > 0 && random() < riverClimbChance);
			if (canContinueFlat) {
				usableCandidates = equalCandidates;
			}
		} else if (lowerCandidates.length > 0) {
			usableCandidates = lowerCandidates;
		}
		if (usableCandidates.length === 0) {
			break;
		}

		let bestElevation = -Infinity;
		for (let i = 0; i < usableCandidates.length; i += 1) {
			bestElevation = Math.max(bestElevation, usableCandidates[i].nextElevation);
		}
		let remaining = usableCandidates.filter(
			(candidate) => candidate.nextElevation === bestElevation
		);
		let selected: RiverCandidate | null = null;
		let segment: Vec2[] = [];
		while (remaining.length > 0 && !selected) {
			const idx = Math.floor(random() * remaining.length);
			const candidate = remaining[idx];
			const candidateSegment = collectRiverEdgeLine(
				mesh,
				candidate.edgeIndex,
				currentVertex,
				candidate.nextVertex
			);
			if (
				candidateSegment.length < 2 ||
				(points.length > 0 &&
					!pointsEqual(points[points.length - 1], candidateSegment[0]))
			) {
				remaining[idx] = remaining[remaining.length - 1];
				remaining.pop();
				continue;
			}
			selected = candidate;
			segment = candidateSegment;
		}
		if (!selected) {
			break;
		}

		appendPath(points, segment);
		edges.push(selected.edgeIndex);
		vertices.push(selected.nextVertex);
		faces.push(selected.nextFace);
		visitedFaces.add(selected.nextFace);

		const nextElevation = selected.nextElevation;
		flatSteps = nextElevation === currentElevation ? flatSteps + 1 : 0;
		currentVertex = selected.nextVertex;
		currentFace = selected.nextFace;
		if (!leftCoast && !coastLand[currentFace]) {
			leftCoast = true;
		}
		currentElevation = nextElevation;
		maxElevation = Math.max(maxElevation, nextElevation);
		steps += 1;
	}

	if (points.length < 2) {
		return null;
	}
	const length = computePathLength(points);
	return {
		edges,
		faces,
		vertices,
		maxElevation,
		length,
		startFace,
	};
}

function traceRiverPath(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	riverSeed: number,
	riverPolylineCache: Map<number, Vec2[]>,
	riverClimbChance: number,
	allowInitialDrop: boolean,
	isLand: boolean[],
	coastLand: boolean[],
	enforceCoastBlock: boolean,
	leftCoast: boolean,
	random: () => number,
	startVertex: number,
	startFace: number,
	maxSteps: number,
	blockedEdges: Set<number>,
	blockedFaces: Set<number>
): RiverTrace | null {
	let currentVertex = startVertex;
	let currentFace = startFace;
	let currentElevation = mesh.faces[currentFace].elevation;
	if (!isLand[startFace]) {
		return null;
	}
	const points: Vec2[] = [];
	const edges: number[] = [];
	const faces: number[] = [startFace];
	const vertices: number[] = [startVertex];
	const visitedFaces = new Set<number>(blockedFaces);
	visitedFaces.add(startFace);
	let maxElevation = currentElevation;
	let flatSteps = 0;
	let steps = 0;

	while (steps < maxSteps) {
		const minElevation = allowInitialDrop && steps === 0 ? 1 : currentElevation;
		const candidates = collectRiverCandidates(
			mesh,
			isLand,
			coastLand,
			enforceCoastBlock,
			leftCoast,
			blockedEdges,
			visitedFaces,
			currentVertex,
			currentFace,
			minElevation
		);
		if (candidates.length === 0) {
			break;
		}
		const higherCandidates = candidates.filter(
			(candidate) => candidate.nextElevation > currentElevation
		);
		const equalCandidates = candidates.filter(
			(candidate) => candidate.nextElevation === currentElevation
		);
		const lowerCandidates =
			allowInitialDrop && steps === 0
				? candidates.filter((candidate) => candidate.nextElevation < currentElevation)
				: [];
		let usableCandidates: RiverCandidate[] = [];
		if (higherCandidates.length > 0) {
			usableCandidates = higherCandidates;
		} else if (equalCandidates.length > 0) {
			const canContinueFlat =
				flatSteps < 3 || (riverClimbChance > 0 && random() < riverClimbChance);
			if (canContinueFlat) {
				usableCandidates = equalCandidates;
			}
		} else if (lowerCandidates.length > 0) {
			usableCandidates = lowerCandidates;
		}
		if (usableCandidates.length === 0) {
			break;
		}

		let bestElevation = -Infinity;
		for (let i = 0; i < usableCandidates.length; i += 1) {
			bestElevation = Math.max(bestElevation, usableCandidates[i].nextElevation);
		}
		let remaining = usableCandidates.filter(
			(candidate) => candidate.nextElevation === bestElevation
		);
		let selected: RiverCandidate | null = null;
		let segment: Vec2[] = [];
		while (remaining.length > 0 && !selected) {
			const idx = Math.floor(random() * remaining.length);
			const candidate = remaining[idx];
			const candidateSegment = collectRiverEdgePolyline(
				mesh,
				refinedGeometry,
				controls,
				riverSeed,
				riverPolylineCache,
				candidate.edgeIndex,
				currentVertex,
				candidate.nextVertex
			);
			if (
				candidateSegment.length < 2 ||
				(points.length > 0 &&
					!pointsEqual(points[points.length - 1], candidateSegment[0]))
			) {
				remaining[idx] = remaining[remaining.length - 1];
				remaining.pop();
				continue;
			}
			selected = candidate;
			segment = candidateSegment;
		}
		if (!selected) {
			break;
		}

		appendPath(points, segment);
		edges.push(selected.edgeIndex);
		vertices.push(selected.nextVertex);
		faces.push(selected.nextFace);
		visitedFaces.add(selected.nextFace);

		const nextElevation = selected.nextElevation;
		flatSteps = nextElevation === currentElevation ? flatSteps + 1 : 0;
		currentVertex = selected.nextVertex;
		currentFace = selected.nextFace;
		if (!leftCoast && !coastLand[currentFace]) {
			leftCoast = true;
		}
		currentElevation = nextElevation;
		maxElevation = Math.max(maxElevation, nextElevation);
		steps += 1;
	}

	if (points.length < 2) {
		return null;
	}
	const length = computePathLength(points);
	return {
		points,
		edges,
		faces,
		vertices,
		maxElevation,
		length,
		startFace,
	};
}

function collectRiverCandidates(
	mesh: MeshGraph,
	isLand: boolean[],
	coastLand: boolean[],
	enforceCoastBlock: boolean,
	leftCoast: boolean,
	blockedEdges: Set<number>,
	visitedFaces: Set<number>,
	currentVertex: number,
	currentFace: number,
	minElevation: number
): RiverCandidate[] {
	const candidates: RiverCandidate[] = [];
	const vertex = mesh.vertices[currentVertex];
	for (let i = 0; i < vertex.edges.length; i += 1) {
		const edgeIndex = vertex.edges[i];
		if (blockedEdges.has(edgeIndex)) {
			continue;
		}
		const edge = mesh.edges[edgeIndex];
		const [faceA, faceB] = edge.faces;
		if (faceA < 0 || faceB < 0) {
			continue;
		}
		if (faceA !== currentFace && faceB !== currentFace) {
			continue;
		}
		const nextFace = faceA === currentFace ? faceB : faceA;
		if (visitedFaces.has(nextFace)) {
			continue;
		}
		if (!isLand[nextFace]) {
			continue;
		}
		if (enforceCoastBlock && leftCoast && coastLand[nextFace]) {
			continue;
		}
		const nextElevation = mesh.faces[nextFace].elevation;
		if (nextElevation < minElevation) {
			continue;
		}
		const nextVertex = edge.vertices[0] === currentVertex ? edge.vertices[1] : edge.vertices[0];
		candidates.push({ edgeIndex, nextVertex, nextFace, nextElevation });
	}
	return candidates;
}

function getRiverBasePolyline(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	riverSeed: number,
	riverPolylineCache: Map<number, Vec2[]>,
	edgeIndex: number
): Vec2[] {
	const cached = riverPolylineCache.get(edgeIndex);
	if (cached) {
		return cached;
	}
	const existing = refinedGeometry.edgePolylines[edgeIndex];
	if (existing && existing.length > 2) {
		riverPolylineCache.set(edgeIndex, existing);
		return existing;
	}
	const edge = mesh.edges[edgeIndex];
	const v0 = mesh.vertices[edge.vertices[0]].point;
	const v1 = mesh.vertices[edge.vertices[1]].point;
	let polyline: Vec2[] = existing && existing.length > 0 ? existing : [v0, v1];

	const [faceA, faceB] = edge.faces;
	if (faceA >= 0 && faceB >= 0) {
		const baseIterations = Math.max(0, Math.round(controls.intermediateMaxIterations));
		const iterationLimit = Math.max(0, Math.round(baseIterations * 0.6));
		const relMagnitude = controls.intermediateRelMagnitude * 0.4;
		const absMagnitude = controls.intermediateAbsMagnitude * 0.4;
		if (iterationLimit > 0 || relMagnitude > 0 || absMagnitude > 0) {
			const edgeSeed = (Math.floor(hash2D(edgeIndex, 17, riverSeed) * 0xffffffff) >>> 0) || 1;
			const edgeRandom = createRng(edgeSeed);
			const inter = generateIntermediate(
				mesh.faces[faceA].point,
				mesh.faces[faceB].point,
				v0,
				v1,
				0,
				edgeRandom,
				iterationLimit,
				controls.intermediateThreshold,
				relMagnitude,
				absMagnitude
			);
			polyline = inter.length > 0 ? [v0, ...inter, v1] : [v0, v1];
		} else {
			polyline = [v0, v1];
		}
	}

	riverPolylineCache.set(edgeIndex, polyline);
	return polyline;
}

function collectRiverEdgePolyline(
	mesh: MeshGraph,
	refinedGeometry: RefinedGeometry,
	controls: TerrainControls,
	riverSeed: number,
	riverPolylineCache: Map<number, Vec2[]>,
	edgeIndex: number,
	fromVertex: number,
	toVertex: number
): Vec2[] {
	const edge = mesh.edges[edgeIndex];
	if (
		!(
			(edge.vertices[0] === fromVertex && edge.vertices[1] === toVertex) ||
			(edge.vertices[1] === fromVertex && edge.vertices[0] === toVertex)
		)
	) {
		return [];
	}
	const base = getRiverBasePolyline(
		mesh,
		refinedGeometry,
		controls,
		riverSeed,
		riverPolylineCache,
		edgeIndex
	);
	if (edge.vertices[0] === fromVertex && edge.vertices[1] === toVertex) {
		return base.slice();
	}
	if (edge.vertices[1] === fromVertex && edge.vertices[0] === toVertex) {
		return base.slice().reverse();
	}
	return [];
}

function concatPaths(prefix: Vec2[], suffix: Vec2[]): Vec2[] {
	const combined = prefix.slice();
	appendPath(combined, suffix);
	return combined;
}

function concatPathsIfConnected(prefix: Vec2[], suffix: Vec2[]): Vec2[] | null {
	if (prefix.length === 0) {
		return suffix.slice();
	}
	if (suffix.length === 0) {
		return prefix.slice();
	}
	if (!pointsEqual(prefix[prefix.length - 1], suffix[0])) {
		return null;
	}
	return concatPaths(prefix, suffix);
}

function computePathLength(points: Vec2[]): number {
	let length = 0;
	for (let i = 1; i < points.length; i += 1) {
		length += vec2Len(vec2Sub(points[i], points[i - 1]));
	}
	return length;
}

function renderRivers(riverLayer: any, rivers: RiverPath[], controls: TerrainControls): void {
	if (!riverLayer || rivers.length === 0) {
		return;
	}
	const graphics = new Graphics();
	const riverColor = 0x2b6db3;
	const riverAlpha = 0.85;
	const strokeCaps = { cap: 'round', join: 'round' } as const;
	const profiles = rivers.map((river) => {
		const totalLength = computePathLength(river.points);
		const lengthT = clamp(totalLength / (controls.spacing * 12), 0, 1);
		const mouthWidth = lerp(2.2, 7.0, smoothstep(lengthT));
		const headWidth = Math.max(0.6, mouthWidth * 0.28);
		return { totalLength, mouthWidth, headWidth };
	});

	const segmentLists = rivers.map((river) => buildPathSegments(river.points));
	const boosts: RiverWidthBoost[][] = rivers.map(() => []);

	for (let i = 0; i < rivers.length; i += 1) {
		const profileA = profiles[i];
		if (profileA.totalLength <= 0) {
			continue;
		}
		for (let j = i + 1; j < rivers.length; j += 1) {
			const profileB = profiles[j];
			if (profileB.totalLength <= 0) {
				continue;
			}
			const intersections = findPathIntersections(
				segmentLists[i],
				segmentLists[j]
			);
			if (intersections.length === 0) {
				continue;
			}
			for (let k = 0; k < intersections.length; k += 1) {
				const { distA, distB } = intersections[k];
				const widthA = riverWidthAtDistance(profileA, distA);
				const widthB = riverWidthAtDistance(profileB, distB);
				if (widthA <= 1e-3 || widthB <= 1e-3) {
					continue;
				}
				if (widthA < widthB) {
					boosts[i].push({ distance: distA, scale: widthB / widthA });
				} else if (widthB < widthA) {
					boosts[j].push({ distance: distB, scale: widthA / widthB });
				}
			}
		}
	}

	const boostFalloff = Math.max(12, controls.spacing * 2.5);

	for (let i = 0; i < rivers.length; i += 1) {
		const river = rivers[i];
		const profile = profiles[i];
		if (profile.totalLength <= 0) {
			continue;
		}
		const depthScale = Math.pow(0.6, river.depth);
		drawRiverPathVariableWidth(
			graphics,
			river.points,
			profile.mouthWidth * depthScale,
			profile.headWidth * depthScale,
			riverColor,
			riverAlpha,
			strokeCaps,
			(distance) => computeBoostScale(boosts[i], distance, boostFalloff)
		);
	}

	riverLayer.addChild(graphics);
}

type RiverWidthProfile = {
	totalLength: number;
	mouthWidth: number;
	headWidth: number;
};

type RiverSegment = {
	a: Vec2;
	b: Vec2;
	length: number;
	startDist: number;
};

type RiverIntersection = {
	distA: number;
	distB: number;
};

type RiverWidthBoost = {
	distance: number;
	scale: number;
};

function riverWidthAtDistance(profile: RiverWidthProfile, distance: number): number {
	if (profile.totalLength <= 0) {
		return 0;
	}
	const t = clamp(distance / profile.totalLength, 0, 1);
	return lerp(profile.mouthWidth, profile.headWidth, smoothstep(t));
}

function computeBoostScale(boosts: RiverWidthBoost[], distance: number, falloff: number): number {
	if (!boosts || boosts.length === 0) {
		return 1;
	}
	let scale = 1;
	for (let i = 0; i < boosts.length; i += 1) {
		const boost = boosts[i];
		if (boost.scale <= 1) {
			continue;
		}
		const delta = Math.abs(distance - boost.distance);
		if (delta >= falloff) {
			continue;
		}
		const t = 1 - delta / falloff;
		const eased = smoothstep(clamp(t, 0, 1));
		const localScale = 1 + (boost.scale - 1) * eased;
		if (localScale > scale) {
			scale = localScale;
		}
	}
	return scale;
}

function buildPathSegments(points: Vec2[]): RiverSegment[] {
	const segments: RiverSegment[] = [];
	let traveled = 0;
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1];
		const b = points[i];
		const length = vec2Len(vec2Sub(b, a));
		if (length <= 0) {
			continue;
		}
		segments.push({ a, b, length, startDist: traveled });
		traveled += length;
	}
	return segments;
}

function findPathIntersections(
	segmentsA: RiverSegment[],
	segmentsB: RiverSegment[]
): RiverIntersection[] {
	const intersections: RiverIntersection[] = [];
	for (let i = 0; i < segmentsA.length; i += 1) {
		const segA = segmentsA[i];
		for (let j = 0; j < segmentsB.length; j += 1) {
			const segB = segmentsB[j];
			const hit = segmentIntersection(segA.a, segA.b, segB.a, segB.b);
			if (!hit) {
				continue;
			}
			intersections.push({
				distA: segA.startDist + hit.t * segA.length,
				distB: segB.startDist + hit.u * segB.length,
			});
		}
	}
	return intersections;
}

function segmentIntersection(
	a: Vec2,
	b: Vec2,
	c: Vec2,
	d: Vec2
): { t: number; u: number } | null {
	const r = vec2Sub(b, a);
	const s = vec2Sub(d, c);
	const denom = r.x * s.y - r.y * s.x;
	const epsilon = 1e-6;
	if (Math.abs(denom) < epsilon) {
		if (pointsEqual(a, c) || pointsEqual(a, d)) {
			return { t: 0, u: pointsEqual(a, c) ? 0 : 1 };
		}
		if (pointsEqual(b, c) || pointsEqual(b, d)) {
			return { t: 1, u: pointsEqual(b, c) ? 0 : 1 };
		}
		return null;
	}
	const cma = vec2Sub(c, a);
	const t = (cma.x * s.y - cma.y * s.x) / denom;
	const u = (cma.x * r.y - cma.y * r.x) / denom;
	if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
		return null;
	}
	const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
	return { t: clamp01(t), u: clamp01(u) };
}

function drawRiverPathVariableWidth(
	graphics: any,
	points: Vec2[],
	mouthWidth: number,
	headWidth: number,
	color: number,
	alpha: number,
	strokeCaps: { cap: 'round'; join: 'round' },
	scaleAtDistance?: (distance: number) => number
): void {
	if (points.length < 2) {
		return;
	}
	const totalLength = computePathLength(points);
	if (totalLength <= 0) {
		return;
	}
	let traveled = 0;
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1];
		const b = points[i];
		const segmentLength = vec2Len(vec2Sub(b, a));
		if (segmentLength <= 0) {
			continue;
		}
		const t = (traveled + segmentLength * 0.5) / totalLength;
		let width = lerp(mouthWidth, headWidth, smoothstep(clamp(t, 0, 1)));
		if (scaleAtDistance) {
			width *= scaleAtDistance(traveled + segmentLength * 0.5);
		}
		graphics.moveTo(a.x, a.y);
		graphics.lineTo(b.x, b.y);
		graphics.stroke({ width, color, alpha, ...strokeCaps });
		traveled += segmentLength;
	}
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
	waterWarpStrength: number,
	landRelief: number,
	ridgeStrength: number,
	ridgeCount: number,
	plateauStrength: number,
	ridgeDistribution: number,
	ridgeSeparation: number,
	ridgeContinuity: number,
	ridgeContinuityThreshold: number,
	oceanPeakClamp: number,
	ridgeOceanClamp: number,
	ridgeWidth: number
): { isLand: boolean[]; oceanWater: boolean[] } {
	// Land elevation is based on coastline distance plus ridge boosts, then optionally smoothed
	// in lowlands and capped by ocean distance.
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

	const maxElevation = MAX_LAND_ELEVATION;
	const redistributionExponent = 1.6;
	const landReliefClamped = clamp(landRelief, 0, 1);
	const ridgeStrengthClamped = clamp(ridgeStrength, 0, 1);
	const ridgeCountClamped = Math.round(clamp(ridgeCount, 1, 10));
	const plateauStrengthClamped = clamp(plateauStrength, 0, 1);
	const ridgeDistributionClamped = clamp(ridgeDistribution, 0, 1);
	const ridgeSeparationClamped = clamp(ridgeSeparation, 0, 1);
	const ridgeContinuityClamped = clamp(ridgeContinuity, 0, 1);
	const ridgeContinuityThresholdClamped = clamp(ridgeContinuityThreshold, 0, 1);
	const oceanPeakClampClamped = clamp(oceanPeakClamp, 0, 1);
	const ridgeOceanClampClamped = clamp(ridgeOceanClamp, 0, 1);
	const ridgeWidthClamped = clamp(ridgeWidth, 0, 1);
	const lowlandMax = 10;

	const landFaces: number[] = [];
	const landBaseLevel = new Array<number>(faceCount).fill(1);
	const landDistance = new Array<number>(faceCount).fill(-1);
	const coastQueue: number[] = [];

	if (hasWater && hasLand) {
		mesh.faces.forEach((face) => {
			if (!isLand[face.index]) {
				return;
			}
			const isShore = face.adjacentFaces.some((neighborIndex) => !isLand[neighborIndex]);
			if (isShore) {
				landDistance[face.index] = 0;
				coastQueue.push(face.index);
			}
		});

		for (let q = 0; q < coastQueue.length; q += 1) {
			const face = mesh.faces[coastQueue[q]];
			const currentDistance = landDistance[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (!isLand[neighborIndex] || landDistance[neighborIndex] >= 0) {
					continue;
				}
				landDistance[neighborIndex] = currentDistance + 1;
				coastQueue.push(neighborIndex);
			}
		}
	}

	let maxLandDistance = 0;
	mesh.faces.forEach((face) => {
		if (isLand[face.index]) {
			landFaces.push(face.index);
			maxLandDistance = Math.max(maxLandDistance, landDistance[face.index]);
		}
	});

	if (hasLand) {
		if (hasWater && maxLandDistance > 0) {
			for (let i = 0; i < landFaces.length; i += 1) {
				const faceIndex = landFaces[i];
				const dist = Math.max(0, landDistance[faceIndex]);
				const base = dist / maxLandDistance;
				const redistributed = Math.pow(base, redistributionExponent);
				const scaled = redistributed * landReliefClamped;
				landBaseLevel[faceIndex] = clamp(
					1 + Math.floor(scaled * (maxElevation - 1)),
					1,
					maxElevation
				);
			}
		} else {
			const uniformLevel = clamp(1 + Math.floor(landReliefClamped * (maxElevation - 1)), 1, maxElevation);
			for (let i = 0; i < landFaces.length; i += 1) {
				landBaseLevel[landFaces[i]] = uniformLevel;
			}
		}
	}

	const ridgeBoost = new Array<number>(faceCount).fill(0);
	if (hasLand && ridgeStrengthClamped > 0 && ridgeCountClamped > 0) {
		const ridgeSeeds = pickRidgeSeedsFromLocalMaxima(
			mesh,
			isLand,
			landFaces,
			landDistance,
			ridgeCountClamped,
			ridgeSeparationClamped,
			random
		);
		const ridgeDistance = new Array<number>(faceCount).fill(-1);
		const ridgeQueue: number[] = [];
		ridgeSeeds.forEach((seed) => {
			ridgeDistance[seed] = 0;
			ridgeQueue.push(seed);
		});
		for (let q = 0; q < ridgeQueue.length; q += 1) {
			const face = mesh.faces[ridgeQueue[q]];
			const currentDistance = ridgeDistance[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (!isLand[neighborIndex] || ridgeDistance[neighborIndex] >= 0) {
					continue;
				}
				ridgeDistance[neighborIndex] = currentDistance + 1;
				ridgeQueue.push(neighborIndex);
			}
		}

		const ridgeRadiusScale =
			lerp(0.25, 1.1, ridgeDistributionClamped) * lerp(1, 0.75, ridgeStrengthClamped);
		const ridgeRadius =
			maxLandDistance > 0
				? Math.max(2, Math.round(maxLandDistance * ridgeRadiusScale))
				: Math.max(2, Math.round(Math.sqrt(landFaces.length) * (0.25 + 0.9 * ridgeDistributionClamped)));
		const ridgeExponent = lerp(2.2, 3.2, ridgeStrengthClamped) * lerp(1, 0.6, ridgeDistributionClamped);
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const dist = ridgeDistance[faceIndex];
			if (dist < 0) {
				continue;
			}
			const ridgeT = 1 - dist / ridgeRadius;
			if (ridgeT <= 0) {
				continue;
			}
			const ridgeShaped = Math.pow(ridgeT, ridgeExponent);
			const coastT = maxLandDistance > 0 ? 1 - landDistance[faceIndex] / maxLandDistance : 0;
			const coastBoost = lerp(1, 1 + 0.7 * coastT, ridgeDistributionClamped);
			const boost = Math.round(
				ridgeShaped *
					coastBoost *
					ridgeStrengthClamped *
					(0.6 + 0.4 * landReliefClamped) *
					(maxElevation - 1)
			);
			ridgeBoost[faceIndex] = clamp(boost, 0, maxElevation - 1);
		}

		if (ridgeContinuityClamped > 0 && ridgeSeeds.length > 1) {
			connectRidgeSeeds(
				mesh,
				isLand,
				ridgeSeeds,
				ridgeBoost,
				ridgeStrengthClamped,
				ridgeContinuityClamped,
				ridgeWidthClamped,
				ridgeDistributionClamped,
				ridgeContinuityThresholdClamped,
				maxElevation,
				maxLandDistance,
				landFaces.length
			);
		}
	}

	const oceanWater = getOceanWaterFaces(mesh, cells, isLand, config);
	const waterElevation = new Array<number>(faceCount).fill(Number.NaN);
	const waterQueue: number[] = [];

	if (hasWater) {
		for (let i = 0; i < mesh.faces.length; i += 1) {
			if (isLand[i]) {
				continue;
			}
			if (!oceanWater[i]) {
				waterElevation[i] = 0;
			}
		}
	}

	if (hasWater && hasLand) {
		mesh.faces.forEach((face) => {
			if (isLand[face.index] || !oceanWater[face.index]) {
				return;
			}
			const isShoreWater = face.adjacentFaces.some((neighborIndex) => isLand[neighborIndex]);
			if (isShoreWater) {
				waterElevation[face.index] = 1;
				waterQueue.push(face.index);
			}
		});

		for (let q = 0; q < waterQueue.length; q += 1) {
			const face = mesh.faces[waterQueue[q]];
			const currentElevation = waterElevation[face.index];
			for (let i = 0; i < face.adjacentFaces.length; i += 1) {
				const neighborIndex = face.adjacentFaces[i];
				if (isLand[neighborIndex] || !oceanWater[neighborIndex]) {
					continue;
				}
				if (Number.isNaN(waterElevation[neighborIndex])) {
					waterElevation[neighborIndex] = currentElevation - 1;
					waterQueue.push(neighborIndex);
				}
			}
		}
	}

	if (hasLand && hasWater && ridgeOceanClampClamped > 0) {
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const dist = Math.max(0, landDistance[faceIndex]);
			const cap = clamp(
				Math.round(lerp(maxElevation - 1, dist * 2, ridgeOceanClampClamped)),
				0,
				maxElevation - 1
			);
			if (ridgeBoost[faceIndex] > cap) {
				ridgeBoost[faceIndex] = cap;
			}
		}
	}

	const finalLandElevation = new Array<number>(faceCount).fill(0);
	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		const base = landBaseLevel[faceIndex];
		const boost = ridgeBoost[faceIndex];
		finalLandElevation[faceIndex] = clamp(base + boost, 1, maxElevation);
	}

	if (hasLand && plateauStrengthClamped > 0) {
		const smoothed = new Array<number>(faceCount).fill(0);
		for (let i = 0; i < landFaces.length; i += 1) {
			const faceIndex = landFaces[i];
			const current = finalLandElevation[faceIndex];
			if (current <= 0 || current > lowlandMax) {
				smoothed[faceIndex] = current;
				continue;
			}
			let sum = current;
			let count = 1;
			const face = mesh.faces[faceIndex];
			for (let j = 0; j < face.adjacentFaces.length; j += 1) {
				const neighbor = face.adjacentFaces[j];
				const neighborElevation = finalLandElevation[neighbor];
				if (!isLand[neighbor] || neighborElevation <= 0 || neighborElevation > lowlandMax) {
					continue;
				}
				sum += neighborElevation;
				count += 1;
			}
			const avg = sum / count;
			const blended = lerp(current, avg, plateauStrengthClamped);
			smoothed[faceIndex] = clamp(Math.round(blended), 1, maxElevation);
		}
	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		finalLandElevation[faceIndex] = smoothed[faceIndex] || finalLandElevation[faceIndex];
	}
}

if (hasLand && hasWater && oceanPeakClampClamped > 0) {
	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		const dist = Math.max(0, landDistance[faceIndex]);
		const cap = clamp(Math.round(lerp(maxElevation, dist * 2, oceanPeakClampClamped)), 1, maxElevation);
		finalLandElevation[faceIndex] = Math.min(finalLandElevation[faceIndex], cap);
	}
}

mesh.faces.forEach((face) => {
	if (isLand[face.index]) {
		face.elevation = finalLandElevation[face.index];
		return;
	}
		if (!hasLand && hasWater) {
			face.elevation = 0;
			return;
		}
		const elevation = waterElevation[face.index];
		face.elevation = Number.isNaN(elevation) ? 0 : elevation;
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

	return { isLand, oceanWater };
}

function pickRidgeSeedsFromLocalMaxima(
	mesh: MeshGraph,
	isLand: boolean[],
	landFaces: number[],
	landDistance: number[],
	count: number,
	ridgeSeparation: number,
	random: () => number
): number[] {
	if (landFaces.length === 0 || count <= 0) {
		return [];
	}
	const candidates: number[] = [];
	for (let i = 0; i < landFaces.length; i += 1) {
		const faceIndex = landFaces[i];
		const dist = landDistance[faceIndex];
		if (dist <= 2) {
			continue;
		}
		const face = mesh.faces[faceIndex];
		let isLocalMax = true;
		for (let j = 0; j < face.adjacentFaces.length; j += 1) {
			const neighbor = face.adjacentFaces[j];
			if (!isLand[neighbor]) {
				continue;
			}
			if (landDistance[neighbor] > dist) {
				isLocalMax = false;
				break;
			}
		}
		if (isLocalMax) {
			candidates.push(faceIndex);
		}
	}

	if (candidates.length === 0) {
		const fallback = landFaces
			.slice()
			.sort((a, b) => landDistance[b] - landDistance[a])
			.filter((faceIndex) => landDistance[faceIndex] > 2);
		candidates.push(...fallback);
	}

	if (candidates.length <= count) {
		return candidates.slice(0, count);
	}

	const componentSeeds = pickComponentPeakSeeds(mesh, isLand, landDistance);
	const picks: number[] = [];
	componentSeeds.forEach((seed) => {
		if (candidates.includes(seed)) {
			picks.push(seed);
		}
	});

	const weighted = candidates.map((faceIndex) => ({
		faceIndex,
		weight: Math.max(1, landDistance[faceIndex] * landDistance[faceIndex]),
	}));
	const targetCount = Math.min(count, weighted.length);
	const separation = clamp(ridgeSeparation, 0, 1);
	const maxSeaDistance = Math.max(1, ...landDistance.filter((dist) => dist >= 0));
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < landFaces.length; i += 1) {
		const point = mesh.faces[landFaces[i]].point;
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	const diag = Math.max(1, Math.hypot(maxX - minX, maxY - minY));

	const pickBySeparation = (): number => {
		if (picks.length === 0) {
			let best = 0;
			let bestSea = -Infinity;
			for (let j = 0; j < weighted.length; j += 1) {
				const faceIndex = weighted[j].faceIndex;
				const distSea = landDistance[faceIndex];
				if (distSea > bestSea) {
					bestSea = distSea;
					best = j;
				}
			}
			return best;
		}
		const scores: number[] = new Array<number>(weighted.length);
		let total = 0;
		for (let j = 0; j < weighted.length; j += 1) {
			const faceIndex = weighted[j].faceIndex;
			const point = mesh.faces[faceIndex].point;
			let minDist = Infinity;
			for (let k = 0; k < picks.length; k += 1) {
				const pickPoint = mesh.faces[picks[k]].point;
				const dx = point.x - pickPoint.x;
				const dy = point.y - pickPoint.y;
				minDist = Math.min(minDist, Math.hypot(dx, dy));
			}
			const distSeaT = clamp(landDistance[faceIndex] / maxSeaDistance, 0, 1);
			const distPeakT = clamp(minDist / diag, 0, 1);
			const mix = lerp(distSeaT, distPeakT, separation);
			const score = Math.max(0.001, mix * mix);
			scores[j] = score;
			total += score;
		}
		if (total <= 0) {
			return 0;
		}
		let roll = random() * total;
		for (let j = 0; j < scores.length; j += 1) {
			roll -= scores[j];
			if (roll <= 0) {
				return j;
			}
		}
		return scores.length - 1;
	};

	for (let i = picks.length; i < targetCount; i += 1) {
		const chosenIndex = pickBySeparation();
		picks.push(weighted[chosenIndex].faceIndex);
		weighted.splice(chosenIndex, 1);
	}

	return picks;
}

function pickComponentPeakSeeds(mesh: MeshGraph, isLand: boolean[], landDistance: number[]): number[] {
	const visited = new Array<boolean>(mesh.faces.length).fill(false);
	const seeds: number[] = [];
	for (let i = 0; i < mesh.faces.length; i += 1) {
		if (!isLand[i] || visited[i]) {
			continue;
		}
		const stack = [i];
		visited[i] = true;
		let bestFace = i;
		let bestDist = landDistance[i];
		while (stack.length > 0) {
			const faceIndex = stack.pop() as number;
			if (landDistance[faceIndex] > bestDist) {
				bestDist = landDistance[faceIndex];
				bestFace = faceIndex;
			}
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
		if (bestDist > 0) {
			seeds.push(bestFace);
		}
	}
	return seeds;
}

function connectRidgeSeeds(
	mesh: MeshGraph,
	isLand: boolean[],
	seeds: number[],
	ridgeBoost: number[],
	ridgeStrength: number,
	ridgeContinuity: number,
	ridgeWidth: number,
	ridgeDistribution: number,
	ridgeContinuityThreshold: number,
	maxElevation: number,
	maxLandDistance: number,
	landFaceCount: number
): void {
	if (ridgeContinuity <= 0 || seeds.length < 2) {
		return;
	}
	const connected: number[] = [seeds[0]];
	const minBoostBase = Math.max(
		1,
		Math.round(ridgeStrength * ridgeContinuity * (maxElevation - 1) * 0.4)
	);

	const threshold = clamp(ridgeContinuityThreshold, 0, 1);
	const maxDistanceBase =
		maxLandDistance > 0
			? maxLandDistance
			: Math.max(2, Math.round(Math.sqrt(Math.max(1, landFaceCount))));
	const minAllowed = Math.max(2, Math.round(maxDistanceBase * 0.1));
	const maxAllowed =
		threshold <= 0
			? Math.max(2, landFaceCount)
			: Math.max(2, Math.round(lerp(maxDistanceBase, minAllowed, threshold)));

	const widthScale = 1 + 0.5 * clamp(ridgeDistribution, 0, 1);
	const widthSteps = Math.max(0, Math.round(lerp(0, 6, ridgeWidth) * widthScale));

	for (let i = 1; i < seeds.length; i += 1) {
		const seed = seeds[i];
		const target = findNearestSeed(mesh, seed, connected);
		if (target < 0) {
			connected.push(seed);
			continue;
		}
		const path = findShortestLandPath(mesh, isLand, seed, target);
		const pathLen = Math.max(1, path.length);
		const pathSteps = Math.max(0, pathLen - 1);
		if (pathSteps > maxAllowed) {
			connected.push(seed);
			continue;
		}
		const boostA = Math.max(ridgeBoost[seed], minBoostBase);
		const boostB = Math.max(ridgeBoost[target], minBoostBase);
		for (let p = 0; p < pathLen; p += 1) {
			const faceIndex = path[p];
			const t = pathLen > 1 ? p / (pathLen - 1) : 0;
			const base = lerp(boostA, boostB, t);
			const blended = lerp(ridgeBoost[faceIndex], base, ridgeContinuity);
			const nextBoost = Math.round(Math.max(blended, minBoostBase * ridgeContinuity));
			ridgeBoost[faceIndex] = clamp(
				Math.max(ridgeBoost[faceIndex], nextBoost),
				0,
				maxElevation - 1
			);
			if (widthSteps > 0) {
				applyRidgeWidth(
					mesh,
					isLand,
					ridgeBoost,
					faceIndex,
					nextBoost,
					widthSteps,
					maxElevation
				);
			}
		}
		connected.push(seed);
	}
}

function applyRidgeWidth(
	mesh: MeshGraph,
	isLand: boolean[],
	ridgeBoost: number[],
	centerFace: number,
	centerBoost: number,
	steps: number,
	maxElevation: number
): void {
	if (steps <= 0) {
		return;
	}
	const queue: Array<{ face: number; depth: number }> = [{ face: centerFace, depth: 0 }];
	const visited = new Set<number>();
	visited.add(centerFace);

	for (let q = 0; q < queue.length; q += 1) {
		const { face, depth } = queue[q];
		if (depth >= steps) {
			continue;
		}
		const nextDepth = depth + 1;
		const falloff = Math.pow(1 - nextDepth / (steps + 1), 1.2);
		const boost = Math.round(centerBoost * falloff);
		const current = ridgeBoost[face];
		if (boost > current) {
			ridgeBoost[face] = clamp(boost, 0, maxElevation - 1);
		}
		const node = mesh.faces[face];
		for (let i = 0; i < node.adjacentFaces.length; i += 1) {
			const neighbor = node.adjacentFaces[i];
			if (!isLand[neighbor] || visited.has(neighbor)) {
				continue;
			}
			visited.add(neighbor);
			queue.push({ face: neighbor, depth: nextDepth });
		}
	}
}

function findNearestSeed(mesh: MeshGraph, seed: number, candidates: number[]): number {
	if (candidates.length === 0) {
		return -1;
	}
	const seedPoint = mesh.faces[seed].point;
	let best = candidates[0];
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i];
		const point = mesh.faces[candidate].point;
		const dx = point.x - seedPoint.x;
		const dy = point.y - seedPoint.y;
		const dist = dx * dx + dy * dy;
		if (dist < bestDist) {
			bestDist = dist;
			best = candidate;
		}
	}
	return best;
}

function findShortestLandPath(
	mesh: MeshGraph,
	isLand: boolean[],
	start: number,
	target: number
): number[] {
	if (start === target) {
		return [start];
	}
	const prev = new Array<number>(mesh.faces.length).fill(-1);
	const queue: number[] = [];
	queue.push(start);
	prev[start] = start;

	for (let q = 0; q < queue.length; q += 1) {
		const faceIndex = queue[q];
		const face = mesh.faces[faceIndex];
		for (let i = 0; i < face.adjacentFaces.length; i += 1) {
			const neighbor = face.adjacentFaces[i];
			if (!isLand[neighbor] || prev[neighbor] >= 0) {
				continue;
			}
			prev[neighbor] = faceIndex;
			if (neighbor === target) {
				q = queue.length;
				break;
			}
			queue.push(neighbor);
		}
	}

	if (prev[target] < 0) {
		return [start];
	}

	const path: number[] = [];
	let current = target;
	while (current !== start) {
		path.push(current);
		current = prev[current];
		if (current < 0) {
			return [start];
		}
	}
	path.push(start);
	path.reverse();
	return path;
}

type ProvinceRenderCache = {
	mesh: MeshGraph;
	refinedGeometry: RefinedGeometry;
	baseCells: Vec2[][];
	provinceGraph: ProvinceGraph;
	config: TerrainConfig;
};

const BASE_LAYER_KEY = '__terrainBaseLayer';
const RIVER_LAYER_KEY = '__terrainRiverLayer';
const PROVINCE_LAYER_KEY = '__terrainProvinceLayer';
const PROVINCE_CACHE_KEY = '__terrainProvinceCache';

function ensureBaseLayer(terrainLayer: any): any {
	const existing = terrainLayer[BASE_LAYER_KEY];
	if (existing) {
		terrainLayer.addChildAt(existing, 0);
		return existing;
	}
	const baseLayer = new Container();
	terrainLayer[BASE_LAYER_KEY] = baseLayer;
	terrainLayer.addChildAt(baseLayer, 0);
	return baseLayer;
}

function ensureRiverLayer(terrainLayer: any): any {
	const existing = terrainLayer[RIVER_LAYER_KEY];
	const targetIndex = Math.min(1, Math.max(0, terrainLayer.children.length - 1));
	if (existing) {
		if (terrainLayer.children[targetIndex] !== existing) {
			terrainLayer.setChildIndex(existing, targetIndex);
		}
		return existing;
	}
	const riverLayer = new Container();
	terrainLayer[RIVER_LAYER_KEY] = riverLayer;
	terrainLayer.addChildAt(riverLayer, targetIndex);
	return riverLayer;
}

function ensureProvinceLayer(terrainLayer: any): any {
	const existing = terrainLayer[PROVINCE_LAYER_KEY];
	if (existing) {
		const targetIndex = terrainLayer[RIVER_LAYER_KEY] ? 2 : 1;
		if (terrainLayer.children.length > targetIndex) {
			terrainLayer.setChildIndex(existing, targetIndex);
		}
		return existing;
	}
	const provinceLayer = new Container();
	terrainLayer[PROVINCE_LAYER_KEY] = provinceLayer;
	const insertIndex = Math.min(terrainLayer[RIVER_LAYER_KEY] ? 2 : 1, terrainLayer.children.length);
	terrainLayer.addChildAt(provinceLayer, insertIndex);
	return provinceLayer;
}

function clearLayerChildren(layer: any): void {
	const removed = layer.removeChildren();
	for (let i = 0; i < removed.length; i += 1) {
		const child = removed[i] as { destroy?: (options?: { children?: boolean }) => void };
		child?.destroy?.({ children: true });
	}
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
	clearLayerChildren(provinceLayer);
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
	// River edges by mesh edge index.
	riverEdges: boolean[];
	// Outer edge indices that are river borders between provinces.
	riverBorders: number[];
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
		const provinceLines = new Graphics();
		const color = provinceColors[p] ?? PROVINCE_BORDER_PALETTE[0];
		for (let i = 0; i < paths.length; i += 1) {
			drawPath(provinceLines, paths[i]);
		}
		provinceLines.stroke({ width: lineWidth, color, alpha: lineAlpha, ...strokeCaps });

		const mask = new Graphics();
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

function landElevationToColor(elevation: number, maxElevation: number): number {
	const t = clamp((elevation - 1) / Math.max(1, maxElevation - 1), 0, 1);
	const stops = [
		{ t: 0, color: 0x3f8a3f },
		{ t: 0.35, color: 0x6e9b4b },
		{ t: 0.6, color: 0x8c7b4f },
		{ t: 0.82, color: 0x9b9488 },
		{ t: 1, color: 0xcfc9c1 },
	];
	for (let i = 0; i < stops.length - 1; i += 1) {
		const a = stops[i];
		const b = stops[i + 1];
		if (t >= a.t && t <= b.t) {
			const localT = (t - a.t) / Math.max(1e-6, b.t - a.t);
			return lerpColor(a.color, b.color, localT);
		}
	}
	return stops[stops.length - 1].color;
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

export function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

export const STEP_SEEDS = {
	mesh: 0x6a09e667,
	water: 0xbb67ae85,
	mountain: 0x3c6ef372,
	river: 0xa54ff53a,
	province: 0x510e527f,
	refine: 0x9b05688c,
};

export function deriveSeed(baseSeed: number, salt: number): number {
	return (baseSeed ^ salt) >>> 0;
}

export function createStepRng(baseSeed: number, salt: number): () => number {
	return createRng(deriveSeed(baseSeed, salt));
}
