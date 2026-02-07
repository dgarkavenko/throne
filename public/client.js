const field = document.getElementById('field');
const statusEl = document.getElementById('status');
const sessionEl = document.getElementById('session');
const fpsEl = document.getElementById('fps');
const terrainSpacingInput = document.getElementById('terrain-spacing');
const terrainSeedInput = document.getElementById('terrain-seed');
const terrainWaterLevelInput = document.getElementById('terrain-water-level');
const terrainWaterRoughnessInput = document.getElementById('terrain-water-roughness');
const terrainGraphsInput = document.getElementById('terrain-graphs');
const terrainSpacingValueEl = document.getElementById('terrain-spacing-value');
const terrainWaterLevelValueEl = document.getElementById('terrain-water-level-value');
const terrainWaterRoughnessValueEl = document.getElementById('terrain-water-roughness-value');

const PHONE_WIDTH = 1560;
const PHONE_HEIGHT = 844;
const COLLIDER_SCALE = 0.9;

const state = {
  socket: null,
  playerId: null,
  players: [],
  currentTyping: '',
  sessionStart: null,
  sessionTimerId: null,
  typingPositions: new Map(),
};

const fpsTracker = {
  lastSample: performance.now(),
  frames: 0,
};

const terrainSettings = {
  spacing: 32,
  showGraphs: false,
  seed: 1337,
  waterLevel: 0,
  waterRoughness: 50,
};

const game = {
  app: null,
  engine: null,
  layers: {
    terrain: null,
    world: null,
    ui: null,
  },
  entities: new Set(),
  addEntity(entity) {
    this.entities.add(entity);
    if (entity.onAdd) {
      entity.onAdd(this);
    }
  },
  removeEntity(entity) {
    if (entity.destroy) {
      entity.destroy(this);
    }
    this.entities.delete(entity);
  },
  update(deltaMs) {
    this.entities.forEach((entity) => {
      if (entity.update) {
        entity.update(deltaMs, this);
      }
    });
  },
};

function updateStatus(message) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return minutes + ':' + paddedSeconds;
}

function updateSessionTimer() {
  if (!sessionEl) {
    return;
  }
  if (!state.sessionStart) {
    sessionEl.textContent = 'Session: --:--';
    return;
  }
  sessionEl.textContent = formatDuration(Date.now() - state.sessionStart);
}

function updateFpsCounter(now) {
  if (!fpsEl) {
    return;
  }
  fpsTracker.frames += 1;
  const elapsed = now - fpsTracker.lastSample;
  if (elapsed < 500) {
    return;
  }
  const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
  fpsEl.textContent = 'FPS: ' + fps;
  fpsTracker.frames = 0;
  fpsTracker.lastSample = now;
}

async function initScene() {
  if (!window.PIXI || game.app) {
    return;
  }
  const appInstance = new PIXI.Application();
  await appInstance.init({
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  game.app = appInstance;
  if (field) {
    field.appendChild(appInstance.canvas ?? appInstance.view);
  }

  const terrainLayer = new PIXI.Container();
  const worldLayer = new PIXI.Container();
  const uiLayer = new PIXI.Container();
  uiLayer.x = 24;
  uiLayer.y = 24;
  appInstance.stage.addChild(terrainLayer);
  appInstance.stage.addChild(worldLayer);
  appInstance.stage.addChild(uiLayer);
  game.layers.terrain = terrainLayer;
  game.layers.world = worldLayer;
  game.layers.ui = uiLayer;

  drawVoronoiTerrain();
  setupPhysics();
  bindMainLoop();
  // enableSpawnOnClick();

  renderPlayers();
}

function parseColor(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.replace('#', '');
  const parsed = Number.parseInt(normalized, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readTerrainSettings() {
  const parsedSpacing = Number.parseInt((terrainSpacingInput && terrainSpacingInput.value) || '32', 10);
  const parsedSeed = Number.parseInt((terrainSeedInput && terrainSeedInput.value) || '1337', 10);
  const parsedWaterLevel = Number.parseInt((terrainWaterLevelInput && terrainWaterLevelInput.value) || '0', 10);
  const parsedWaterRoughness = Number.parseInt((terrainWaterRoughnessInput && terrainWaterRoughnessInput.value) || '50', 10);
  return {
    spacing: clamp(Number.isNaN(parsedSpacing) ? 32 : parsedSpacing, 32, 128),
    seed: clamp(Number.isNaN(parsedSeed) ? 1337 : parsedSeed, 0, 0xffffffff),
    waterLevel: clamp(Number.isNaN(parsedWaterLevel) ? 0 : parsedWaterLevel, -40, 40),
    waterRoughness: clamp(Number.isNaN(parsedWaterRoughness) ? 50 : parsedWaterRoughness, 0, 100),
    showGraphs: Boolean(terrainGraphsInput && terrainGraphsInput.checked),
  };
}

function syncTerrainControlLabels() {
  if (terrainSpacingValueEl) {
    terrainSpacingValueEl.textContent = String(terrainSettings.spacing);
  }
  if (terrainWaterLevelValueEl) {
    terrainWaterLevelValueEl.textContent = String(terrainSettings.waterLevel);
  }
  if (terrainWaterRoughnessValueEl) {
    terrainWaterRoughnessValueEl.textContent = String(terrainSettings.waterRoughness);
  }
}

function applyTerrainSettings(nextSettings) {
  terrainSettings.spacing = nextSettings.spacing;
  terrainSettings.showGraphs = nextSettings.showGraphs;
  terrainSettings.seed = nextSettings.seed;
  terrainSettings.waterLevel = nextSettings.waterLevel;
  terrainSettings.waterRoughness = nextSettings.waterRoughness;
  if (terrainSpacingInput) {
    terrainSpacingInput.value = String(terrainSettings.spacing);
  }
  if (terrainSeedInput) {
    terrainSeedInput.value = String(terrainSettings.seed);
  }
  if (terrainWaterLevelInput) {
    terrainWaterLevelInput.value = String(terrainSettings.waterLevel);
  }
  if (terrainWaterRoughnessInput) {
    terrainWaterRoughnessInput.value = String(terrainSettings.waterRoughness);
  }
  if (terrainGraphsInput) {
    terrainGraphsInput.checked = terrainSettings.showGraphs;
  }
  syncTerrainControlLabels();
  if (game.layers.terrain) {
    drawVoronoiTerrain();
  }
}

function drawVoronoiTerrain() {
  if (!game.layers.terrain || !window.PIXI) {
    return;
  }
  const terrainLayer = game.layers.terrain;
  terrainLayer.removeChildren();

  const waterTint = new PIXI.Graphics();
  waterTint.rect(0, 0, PHONE_WIDTH, PHONE_HEIGHT);
  waterTint.fill({ color: 0x0d1a2e, alpha: 0.18 });
  terrainLayer.addChild(waterTint);

  const seed = terrainSettings.seed >>> 0;
  const random = createRng(seed);
  const padding = 0;
  const sites = generatePoissonSites(terrainSettings.spacing, padding, random);
  const cells = new Array(sites.length);

  sites.forEach((site, index) => {
    cells[index] = buildVoronoiCell(site, sites);
  });

  const graph = buildMapGraph(sites, cells);
  assignIslandWater(graph, cells, random, terrainSettings.waterLevel, terrainSettings.waterRoughness);
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

    const terrain = new PIXI.Graphics();
    terrain.poly(flattenPolygon(cell), true);
    terrain.fill({ color: fillColor, alpha: fillAlpha });
    terrain.stroke({ width: 1.2, color: strokeColor, alpha: strokeAlpha });
    terrainLayer.addChild(terrain);
  });

  if (terrainSettings.showGraphs) {
    drawGraphOverlay(graph, terrainLayer);
  }
}

function generatePoissonSites(spacing, padding, random) {
  return samplePoissonDisc(spacing, padding, random);
}

function samplePoissonDisc(minDistance, padding, random) {
  const maxAttemptsPerActivePoint = 30;
  const width = PHONE_WIDTH - padding * 2;
  const height = PHONE_HEIGHT - padding * 2;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const cellSize = minDistance / Math.sqrt(2);
  const gridWidth = Math.max(1, Math.ceil(width / cellSize));
  const gridHeight = Math.max(1, Math.ceil(height / cellSize));
  const grid = new Array(gridWidth * gridHeight).fill(-1);
  const points = [];
  const active = [];

  const toGridX = (x) => Math.floor((x - padding) / cellSize);
  const toGridY = (y) => Math.floor((y - padding) / cellSize);
  const isInBounds = (point) =>
    point.x >= padding && point.x <= PHONE_WIDTH - padding && point.y >= padding && point.y <= PHONE_HEIGHT - padding;

  const registerPoint = (point) => {
    points.push(point);
    const index = points.length - 1;
    active.push(index);
    const gx = clamp(toGridX(point.x), 0, gridWidth - 1);
    const gy = clamp(toGridY(point.y), 0, gridHeight - 1);
    grid[gy * gridWidth + gx] = index;
  };

  const isFarEnough = (point) => {
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
    const origin = points[active[activeListIndex]];
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

function buildVoronoiCell(site, sites) {
  let polygon = [
    { x: 0, y: 0 },
    { x: PHONE_WIDTH, y: 0 },
    { x: PHONE_WIDTH, y: PHONE_HEIGHT },
    { x: 0, y: PHONE_HEIGHT },
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

function clipPolygonWithHalfPlane(polygon, midpoint, normal) {
  if (polygon.length === 0) {
    return [];
  }
  const clipped = [];
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

function evaluateLine(point, midpoint, normal) {
  return (point.x - midpoint.x) * normal.x + (point.y - midpoint.y) * normal.y;
}

function intersectSegmentWithLine(start, end, midpoint, startValue, endValue) {
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

function flattenPolygon(polygon) {
  const flat = [];
  for (let i = 0; i < polygon.length; i += 1) {
    flat.push(polygon[i].x, polygon[i].y);
  }
  return flat;
}

function buildMapGraph(sites, cells) {
  const centers = sites.map((site, index) => ({
    index,
    point: site,
    corners: [],
    neighbors: [],
    borders: [],
    water: false,
    ocean: false,
    coast: false,
  }));
  const corners = [];
  const edges = [];
  const cornerLookup = new Map();
  const edgeLookup = new Map();

  const quantize = (value) => Math.round(value * 1000);
  const cornerKey = (point) => quantize(point.x) + ':' + quantize(point.y);
  const edgeKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

  const getCornerIndex = (point) => {
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
    const cellCornerIndices = [];
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
    const cornerA = edge.corners[0];
    const cornerB = edge.corners[1];
    pushUnique(corners[cornerA].adjacent, cornerB);
    pushUnique(corners[cornerB].adjacent, cornerA);
    pushUnique(corners[cornerA].protrudes, edge.index);
    pushUnique(corners[cornerB].protrudes, edge.index);

    const centerA = edge.centers[0];
    const centerB = edge.centers[1];
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

function assignIslandWater(graph, cells, random, waterLevel, waterRoughness) {
  const width = PHONE_WIDTH;
  const height = PHONE_HEIGHT;
  const normalizedWaterLevel = clamp(waterLevel, -40, 40) / 40;
  const normalizedRoughness = clamp(waterRoughness, 0, 100) / 100;
  const bumps = 3 + Math.floor(normalizedRoughness * 7) + Math.floor(random() * 3);
  const startAngle = random() * Math.PI * 2;
  const borderEpsilon = 1;
  const baseRadius = 0.74 - normalizedWaterLevel * 0.18;
  const primaryWaveAmplitude = 0.06 + normalizedRoughness * 0.14;
  const secondaryWaveAmplitude = 0.03 + normalizedRoughness * 0.1;

  const islandShape = (point) => {
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

  const touchesBorder = (centerIndex) => {
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

  const queue = [];
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

function drawGraphOverlay(graph, terrainLayer) {
  if (!window.PIXI) {
    return;
  }
  const graphLayer = new PIXI.Container();

  const polygonGraph = new PIXI.Graphics();
  graph.edges.forEach((edge) => {
    const cornerA = graph.corners[edge.corners[0]].point;
    const cornerB = graph.corners[edge.corners[1]].point;
    polygonGraph.moveTo(cornerA.x, cornerA.y);
    polygonGraph.lineTo(cornerB.x, cornerB.y);
  });
  polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });
  graphLayer.addChild(polygonGraph);

  const dualGraph = new PIXI.Graphics();
  graph.edges.forEach((edge) => {
    const centerA = edge.centers[0];
    const centerB = edge.centers[1];
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

  const cornerNodes = new PIXI.Graphics();
  graph.corners.forEach((corner) => {
    cornerNodes.circle(corner.point.x, corner.point.y, 1.8);
  });
  cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });
  graphLayer.addChild(cornerNodes);

  const centerNodes = new PIXI.Graphics();
  graph.centers.forEach((center) => {
    centerNodes.circle(center.point.x, center.point.y, 2.3);
  });
  centerNodes.fill({ color: 0xfff0c9, alpha: 0.95 });
  graphLayer.addChild(centerNodes);

  terrainLayer.addChild(graphLayer);
}

function pushUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function setupPhysics() {
  if (!window.Matter || !game.app) {
    return;
  }
  const { Engine, Bodies, World } = Matter;
  const engine = Engine.create({
    gravity: { x: 0, y: 1 },
  });
  game.engine = engine;

  const wallThickness = 120;
  const boundaries = [
    Bodies.rectangle(PHONE_WIDTH / 2, PHONE_HEIGHT + wallThickness / 2, PHONE_WIDTH + wallThickness * 2, wallThickness, {
      isStatic: true,
    }),
    Bodies.rectangle(PHONE_WIDTH / 2, -wallThickness / 2, PHONE_WIDTH + wallThickness * 2, wallThickness, {
      isStatic: true,
    }),
    Bodies.rectangle(-wallThickness / 2, PHONE_HEIGHT / 2, wallThickness, PHONE_HEIGHT + wallThickness * 2, {
      isStatic: true,
    }),
    Bodies.rectangle(PHONE_WIDTH + wallThickness / 2, PHONE_HEIGHT / 2, wallThickness, PHONE_HEIGHT + wallThickness * 2, {
      isStatic: true,
    }),
  ];
  World.add(engine.world, boundaries);
}

function bindMainLoop() {
  if (!game.app || !game.engine) {
    return;
  }
  game.app.ticker.add((ticker) => {
    Matter.Engine.update(game.engine, ticker.deltaMS);
    game.update(ticker.deltaMS);
    updateFpsCounter(performance.now());
  });
}

function enableSpawnOnClick() {
  if (!game.app) {
    return;
  }
  game.app.stage.eventMode = 'static';
  game.app.stage.hitArea = game.app.screen;
  game.app.stage.on('pointerdown', (event) => {
    spawnBox(event.global.x, event.global.y);
  });
}

function createPhysicsEntity(body, display) {
  if (!game.engine || !game.layers.world) {
    return null;
  }
  Matter.World.add(game.engine.world, body);
  game.layers.world.addChild(display);
  const entity = {
    body,
    display,
    update() {
      display.x = body.position.x;
      display.y = body.position.y;
      display.rotation = body.angle;
    },
    destroy(currentGame) {
      if (currentGame.engine) {
        Matter.World.remove(currentGame.engine.world, body);
      }
      if (display.removeFromParent) {
        display.removeFromParent();
      }
    },
  };
  game.addEntity(entity);
  return entity;
}

function spawnBox(x, y) {
  if (!game.engine || !game.app || !window.Matter || !window.PIXI) {
    return;
  }
  const size = 24 + Math.random() * 32;
  const { Bodies, Body } = Matter;
  const colliderSize = size * COLLIDER_SCALE;
  const body = Bodies.rectangle(x, y, colliderSize, colliderSize, {
    restitution: 0.6,
    friction: 0.3,
    density: 0.002,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 12,
    y: (Math.random() - 0.5) * 12,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);

  const graphic = new PIXI.Graphics();
  graphic.roundRect(-size / 2, -size / 2, size, size, Math.min(10, size / 3));
  graphic.fill({ color: 0x57b9ff, alpha: 0.9 });
  graphic.stroke({ width: 2, color: 0x0b0e12, alpha: 0.8 });
  graphic.x = x;
  graphic.y = y;

  createPhysicsEntity(body, graphic);
}

function spawnTextBox(text, color, emoji, spawnPosition) {
  if (!game.engine || !game.app || !window.Matter || !window.PIXI) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const style = new PIXI.TextStyle({
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    fontSize: 28,
    fill: color || '#f5f5f5',
    fontWeight: '600',
    wordWrap: true,
    wordWrapWidth: PHONE_WIDTH - 80,
  });
  const textSprite = new PIXI.Text(trimmed, style);
  if (textSprite.anchor && textSprite.anchor.set) {
    textSprite.anchor.set(0.5);
  }

  const boxWidth = textSprite.width;
  const boxHeight = textSprite.height;
  const position = spawnPosition || { x: PHONE_WIDTH / 2, y: PHONE_HEIGHT / 4 };
  const x = position.x;
  const y = position.y;
  const { Bodies, Body } = Matter;
  const body = Bodies.rectangle(x, y, boxWidth * COLLIDER_SCALE, boxHeight * COLLIDER_SCALE, {
    restitution: 0.5,
    friction: 0.4,
    density: 0.0025,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 2.5,
    y: (Math.random() - 0.5) * 2.5,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);

  const container = new PIXI.Container();
  const background = new PIXI.Graphics();
  background.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  background.fill({ color: 0x0b0e12, alpha: 1 });
  container.addChild(background);
  textSprite.x = 0;
  textSprite.y = 0;
  container.addChild(textSprite);
  container.x = x;
  container.y = y;

  createPhysicsEntity(body, container);
}

function getHistorySpawnPosition(index, total) {
  const clampedTotal = Math.max(1, total);
  const lowerBound = PHONE_HEIGHT - 140;
  const upperBound = 140;
  const progress = clampedTotal === 1 ? 0 : index / (clampedTotal - 1);
  const y = lowerBound - progress * (lowerBound - upperBound);
  const jitter = 24;
  return {
    x: PHONE_WIDTH / 2 + (Math.random() - 0.5) * jitter,
    y: y + (Math.random() - 0.5) * jitter,
  };
}

function renderPlayers() {
  if (!game.layers.ui || !window.PIXI) {
    return;
  }
  const uiLayer = game.layers.ui;
  uiLayer.removeChildren();
  state.typingPositions.clear();
  state.players.forEach((player, index) => {
    const style = new PIXI.TextStyle({
      fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      fontSize: 28,
      fill: player.color || '#f5f5f5',
    });
    const avatar = (player.emoji || '\ud83e\udea7') + ':';
    const typingText = player.typing ? ' ' + player.typing : '';
    const row = new PIXI.Container();
    const avatarText = new PIXI.Text(avatar, style);
    const typingSprite = new PIXI.Text(typingText, style);
    typingSprite.x = avatarText.width;
    row.addChild(avatarText);
    row.addChild(typingSprite);
    row.x = 0;
    row.y = index * 36;
    uiLayer.addChild(row);
    state.typingPositions.set(player.id, {
      x: uiLayer.x + row.x + avatarText.width + typingSprite.width / 2,
      y: uiLayer.y + row.y + avatarText.height / 2,
    });
  });
}

function connect() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'lobby';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol + '://' + location.host + '/room/' + roomId;
  state.socket = new WebSocket(url);

  const connectTimeout = setTimeout(() => {
    if (state.socket && state.socket.readyState !== WebSocket.OPEN) {
      updateStatus('Unable to connect. Check the server and refresh.');
    }
  }, 4000);

  state.socket.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    updateStatus('Connected to room ' + roomId + '.');
    document.body.classList.add('connected');
    if (state.socket) {
      state.socket.send(JSON.stringify({ type: 'join' }));
    }
  });

  state.socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'welcome') {
      state.playerId = payload.id;
    }
    if (payload.type === 'state') {
      state.players = payload.players || [];
      state.sessionStart = typeof payload.sessionStart === 'number' ? payload.sessionStart : null;
      renderPlayers();
      updateSessionTimer();
    }
    if (payload.type === 'history' && Array.isArray(payload.messages)) {
      const totalMessages = payload.messages.length;
      payload.messages.forEach((message, index) => {
        if (!message || typeof message.text !== 'string') {
          return;
        }
        const spawnPosition = getHistorySpawnPosition(index, totalMessages);
        spawnTextBox(message.text, message.color, message.emoji, spawnPosition);
      });
    }
    if (payload.type === 'launch') {
      spawnTextBox(payload.text || '', payload.color, payload.emoji, state.typingPositions.get(payload.id));
    }
  });

  state.socket.addEventListener('error', () => {
    updateStatus('Connection error. Refresh to retry.');
  });

  state.socket.addEventListener('close', () => {
    updateStatus('Disconnected. Refresh to reconnect.');
    document.body.classList.remove('connected');
  });
}

function sendTyping() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: 'typing',
      text: state.currentTyping,
    })
  );
}

function sendLaunch(text) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: 'launch',
      text,
    })
  );
}

applyTerrainSettings(readTerrainSettings());
if (terrainSpacingInput) {
  terrainSpacingInput.addEventListener('input', () => {
    applyTerrainSettings(readTerrainSettings());
  });
}
if (terrainSeedInput) {
  terrainSeedInput.addEventListener('change', () => {
    applyTerrainSettings(readTerrainSettings());
  });
}
if (terrainWaterLevelInput) {
  terrainWaterLevelInput.addEventListener('input', () => {
    applyTerrainSettings(readTerrainSettings());
  });
}
if (terrainWaterRoughnessInput) {
  terrainWaterRoughnessInput.addEventListener('input', () => {
    applyTerrainSettings(readTerrainSettings());
  });
}
if (terrainGraphsInput) {
  terrainGraphsInput.addEventListener('change', () => {
    applyTerrainSettings(readTerrainSettings());
  });
}

void initScene();
connect();
if (!state.sessionTimerId) {
  state.sessionTimerId = setInterval(updateSessionTimer, 1000);
}
updateSessionTimer();

function handleKeyDown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === 'Backspace') {
    state.currentTyping = state.currentTyping.slice(0, -1);
    sendTyping();
    return;
  }
  if (event.key === 'Escape' || event.key === 'Enter') {
    if (event.key === 'Enter' && state.currentTyping.trim()) {
      sendLaunch(state.currentTyping);
    }
    state.currentTyping = '';
    sendTyping();
    return;
  }
  if (event.key.length === 1) {
    state.currentTyping += event.key;
    sendTyping();
  }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('blur', () => {
  // Intentionally keep currentTyping when the tab loses focus.
});
