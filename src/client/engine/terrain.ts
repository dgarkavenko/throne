export type TerrainControls = {
  spacing: number;
  showGraphs: boolean;
  seed: number;
  waterLevel: number;
  waterRoughness: number;
};

type Vec2 = {
  x: number;
  y: number;
};

type GraphCenter = {
  index: number;
  point: Vec2;
  corners: number[];
  neighbors: number[];
  borders: number[];
  water: boolean;
  ocean: boolean;
  coast: boolean;
};

type GraphCorner = {
  index: number;
  point: Vec2;
  centers: number[];
  adjacent: number[];
  protrudes: number[];
  water: boolean;
  ocean: boolean;
  coast: boolean;
};

type GraphEdge = {
  index: number;
  centers: [number, number];
  corners: [number, number];
  midpoint: Vec2;
};

type MapGraph = {
  centers: GraphCenter[];
  corners: GraphCorner[];
  edges: GraphEdge[];
};

type TerrainConfig = {
  width: number;
  height: number;
};

export function drawVoronoiTerrain(
  config: TerrainConfig,
  controls: TerrainControls,
  terrainLayer: any
): void {
  if (!terrainLayer || !window.PIXI) {
    return;
  }
  terrainLayer.removeChildren();

  const waterTint = new window.PIXI.Graphics();
  waterTint.rect(0, 0, config.width, config.height);
  waterTint.fill({ color: 0x0d1a2e, alpha: 0.18 });
  terrainLayer.addChild(waterTint);

  const seed = controls.seed >>> 0;
  const random = createRng(seed);
  const padding = 0;
  const sites = generatePoissonSites(config, controls.spacing, padding, random);
  const cells: Vec2[][] = new Array(sites.length);
  sites.forEach((site, index) => {
    cells[index] = buildVoronoiCell(config, site, sites);
  });

  const graph = buildMapGraph(sites, cells);
  assignIslandWater(config, graph, cells, random, controls.waterLevel, controls.waterRoughness);
  const landPalette = [0x2d5f3a, 0x3b7347, 0x4a8050, 0x5c8b61, 0x6d9570];

  graph.centers.forEach((center) => {
    const cell = cells[center.index];
    if (!cell || cell.length < 3) {
      return;
    }
    let fillColor = landPalette[Math.floor(random() * landPalette.length)];
    let fillAlpha = 0.78;
    let strokeColor = 0xcadfb8;
    let strokeAlpha = 0.42;

    if (center.ocean) {
      fillColor = 0x153961;
      fillAlpha = 0.88;
      strokeColor = 0x7aa3ce;
      strokeAlpha = 0.36;
    } else if (center.water) {
      fillColor = 0x2d5f8d;
      fillAlpha = 0.84;
      strokeColor = 0x9dc2e6;
      strokeAlpha = 0.35;
    } else if (center.coast) {
      fillColor = 0x8c7b4f;
      fillAlpha = 0.82;
      strokeColor = 0xdac38e;
      strokeAlpha = 0.38;
    }

    const terrain = new window.PIXI.Graphics();
    terrain.poly(flattenPolygon(cell), true);
    terrain.fill({ color: fillColor, alpha: fillAlpha });
    terrain.stroke({ width: 1.2, color: strokeColor, alpha: strokeAlpha });
    terrainLayer.addChild(terrain);
  });

  if (controls.showGraphs) {
    drawGraphOverlay(graph, terrainLayer);
  }
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

function buildMapGraph(sites: Vec2[], cells: Vec2[][]): MapGraph {
  const centers: GraphCenter[] = sites.map((site, index) => ({
    index,
    point: site,
    corners: [],
    neighbors: [],
    borders: [],
    water: false,
    ocean: false,
    coast: false,
  }));
  const corners: GraphCorner[] = [];
  const edges: GraphEdge[] = [];
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
    const index = corners.length;
    corners.push({
      index,
      point: { x: point.x, y: point.y },
      centers: [],
      adjacent: [],
      protrudes: [],
      water: false,
      ocean: false,
      coast: false,
    });
    cornerLookup.set(key, index);
    return index;
  };

  cells.forEach((cell, centerIndex) => {
    if (!cell || cell.length < 3) {
      return;
    }
    const center = centers[centerIndex];
    const cellCornerIndices: number[] = [];
    for (let i = 0; i < cell.length; i += 1) {
      const cornerIndex = getCornerIndex(cell[i]);
      cellCornerIndices.push(cornerIndex);
      pushUnique(corners[cornerIndex].centers, centerIndex);
      pushUnique(center.corners, cornerIndex);
    }
    for (let i = 0; i < cellCornerIndices.length; i += 1) {
      const a = cellCornerIndices[i];
      const b = cellCornerIndices[(i + 1) % cellCornerIndices.length];
      const key = edgeKey(a, b);
      let borderIndex = edgeLookup.get(key);
      if (borderIndex === undefined) {
        borderIndex = edges.length;
        const cornerA = corners[a].point;
        const cornerB = corners[b].point;
        edges.push({
          index: borderIndex,
          centers: [centerIndex, -1],
          corners: [a, b],
          midpoint: {
            x: (cornerA.x + cornerB.x) * 0.5,
            y: (cornerA.y + cornerB.y) * 0.5,
          },
        });
        edgeLookup.set(key, borderIndex);
      } else {
        const edge = edges[borderIndex];
        if (edge.centers[0] !== centerIndex && edge.centers[1] !== centerIndex) {
          edge.centers[1] = centerIndex;
        }
      }
      pushUnique(center.borders, borderIndex);
    }
  });

  edges.forEach((edge) => {
    const [cornerA, cornerB] = edge.corners;
    pushUnique(corners[cornerA].adjacent, cornerB);
    pushUnique(corners[cornerB].adjacent, cornerA);
    pushUnique(corners[cornerA].protrudes, edge.index);
    pushUnique(corners[cornerB].protrudes, edge.index);

    const [centerA, centerB] = edge.centers;
    if (centerA >= 0) {
      pushUnique(centers[centerA].borders, edge.index);
    }
    if (centerB >= 0) {
      pushUnique(centers[centerB].borders, edge.index);
    }
    if (centerA >= 0 && centerB >= 0) {
      pushUnique(centers[centerA].neighbors, centerB);
      pushUnique(centers[centerB].neighbors, centerA);
    }
  });

  return { centers, corners, edges };
}

function assignIslandWater(
  config: TerrainConfig,
  graph: MapGraph,
  cells: Vec2[][],
  random: () => number,
  waterLevel: number,
  waterRoughness: number
): void {
  const width = config.width;
  const height = config.height;
  const normalizedWaterLevel = clamp(waterLevel, -40, 40) / 40;
  const normalizedRoughness = clamp(waterRoughness, 0, 100) / 100;
  const bumps = 3 + Math.floor(normalizedRoughness * 7) + Math.floor(random() * 3);
  const startAngle = random() * Math.PI * 2;
  const borderEpsilon = 1;
  const baseRadius = 0.74 - normalizedWaterLevel * 0.18;
  const primaryWaveAmplitude = 0.06 + normalizedRoughness * 0.14;
  const secondaryWaveAmplitude = 0.03 + normalizedRoughness * 0.1;

  const islandShape = (point: Vec2): boolean => {
    const nx = (point.x / width) * 2 - 1;
    const ny = (point.y / height) * 2 - 1;
    const angle = Math.atan2(ny, nx);
    const length = 0.5 * (Math.max(Math.abs(nx), Math.abs(ny)) + Math.hypot(nx, ny));
    const radius = clamp(
      baseRadius +
        primaryWaveAmplitude * Math.sin(startAngle + bumps * angle + Math.cos((bumps + 2) * angle)) +
        secondaryWaveAmplitude * Math.sin(startAngle * 0.7 + (bumps + 3) * angle),
      0.16,
      0.96
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

  graph.centers.forEach((center) => {
    center.water = touchesBorder(center.index) || !islandShape(center.point);
    center.ocean = false;
    center.coast = false;
  });

  const queue: number[] = [];
  graph.centers.forEach((center) => {
    if (center.water && touchesBorder(center.index)) {
      center.ocean = true;
      queue.push(center.index);
    }
  });

  for (let q = 0; q < queue.length; q += 1) {
    const center = graph.centers[queue[q]];
    for (let i = 0; i < center.neighbors.length; i += 1) {
      const neighbor = graph.centers[center.neighbors[i]];
      if (neighbor.water && !neighbor.ocean) {
        neighbor.ocean = true;
        queue.push(neighbor.index);
      }
    }
  }

  graph.centers.forEach((center) => {
    if (!center.water) {
      center.coast = center.neighbors.some((neighborIndex) => graph.centers[neighborIndex].ocean);
    }
  });

  graph.corners.forEach((corner) => {
    if (corner.centers.length === 0) {
      corner.water = true;
      corner.ocean = true;
      corner.coast = false;
      return;
    }
    let waterCount = 0;
    let oceanCount = 0;
    for (let i = 0; i < corner.centers.length; i += 1) {
      const center = graph.centers[corner.centers[i]];
      if (center.water) {
        waterCount += 1;
      }
      if (center.ocean) {
        oceanCount += 1;
      }
    }
    corner.water = waterCount === corner.centers.length;
    corner.ocean = oceanCount === corner.centers.length;
    corner.coast = waterCount > 0 && waterCount < corner.centers.length;
  });
}

function drawGraphOverlay(graph: MapGraph, terrainLayer: any): void {
  if (!window.PIXI) {
    return;
  }
  const graphLayer = new window.PIXI.Container();

  const polygonGraph = new window.PIXI.Graphics();
  graph.edges.forEach((edge) => {
    const cornerA = graph.corners[edge.corners[0]].point;
    const cornerB = graph.corners[edge.corners[1]].point;
    polygonGraph.moveTo(cornerA.x, cornerA.y);
    polygonGraph.lineTo(cornerB.x, cornerB.y);
  });
  polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });
  graphLayer.addChild(polygonGraph);

  const dualGraph = new window.PIXI.Graphics();
  graph.edges.forEach((edge) => {
    const [centerA, centerB] = edge.centers;
    if (centerA < 0 || centerB < 0) {
      return;
    }
    const a = graph.centers[centerA].point;
    const b = graph.centers[centerB].point;
    dualGraph.moveTo(a.x, a.y);
    dualGraph.lineTo(b.x, b.y);
  });
  dualGraph.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });
  graphLayer.addChild(dualGraph);

  const cornerNodes = new window.PIXI.Graphics();
  graph.corners.forEach((corner) => {
    cornerNodes.circle(corner.point.x, corner.point.y, 1.8);
  });
  cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });
  graphLayer.addChild(cornerNodes);

  const centerNodes = new window.PIXI.Graphics();
  graph.centers.forEach((center) => {
    centerNodes.circle(center.point.x, center.point.y, 2.3);
  });
  centerNodes.fill({ color: 0xfff0c9, alpha: 0.95 });
  graphLayer.addChild(centerNodes);

  terrainLayer.addChild(graphLayer);
}

function pushUnique(values: number[], value: number): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
