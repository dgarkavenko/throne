import type { PlayerState } from '../types';

type GameEntity = {
  onAdd?: (currentGame: GameEngine) => void;
  update?: (deltaMs: number, currentGame: GameEngine) => void;
  destroy?: (currentGame: GameEngine) => void;
};

type GameConfig = {
  width: number;
  height: number;
  colliderScale: number;
  uiOffset: { x: number; y: number };
};

type Vec2 = {
  x: number;
  y: number;
};

type TerrainControls = {
  pointCount: number;
  spacing: number;
  showGraphs: boolean;
  seed: number;
  waterLevel: number;
  waterRoughness: number;
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

export class GameEngine {
  private app: any = null;
  private engine: any = null;
  private layers = {
    terrain: null as any,
    world: null as any,
    ui: null as any,
  };
  private entities = new Set<GameEntity>();
  private typingPositions = new Map<string, { x: number; y: number }>();
  private readonly config: GameConfig;
  private terrainControls: TerrainControls = {
    pointCount: 72,
    spacing: 32,
    showGraphs: false,
    seed: 1337,
    waterLevel: 0,
    waterRoughness: 50,
  };

  constructor(config: GameConfig) {
    this.config = config;
  }

  async init(field: HTMLElement | null): Promise<void> {
    if (!window.PIXI || this.app) {
      return;
    }
    const appInstance = new window.PIXI.Application();
    await appInstance.init({
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.app = appInstance;
    if (field) {
      field.appendChild(appInstance.canvas ?? appInstance.view);
    }

    const terrainLayer = new window.PIXI.Container();
    const worldLayer = new window.PIXI.Container();
    const uiLayer = new window.PIXI.Container();
    uiLayer.x = this.config.uiOffset.x;
    uiLayer.y = this.config.uiOffset.y;
    appInstance.stage.addChild(terrainLayer);
    appInstance.stage.addChild(worldLayer);
    appInstance.stage.addChild(uiLayer);
    this.layers.terrain = terrainLayer;
    this.layers.world = worldLayer;
    this.layers.ui = uiLayer;

    this.drawVoronoiTerrain();
    this.setupPhysics();
  }

  setVoronoiControls(
    pointCount: number,
    spacing: number,
    showGraphs: boolean,
    seed: number,
    waterLevel: number,
    waterRoughness: number
  ): void {
    const safeValue = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);
    this.terrainControls = {
      pointCount: this.clamp(Math.round(safeValue(pointCount, 72)), 64, 2048),
      spacing: this.clamp(Math.round(safeValue(spacing, 32)), 32, 128),
      showGraphs,
      seed: this.clamp(Math.floor(safeValue(seed, 1337)), 0, 0xffffffff),
      waterLevel: this.clamp(Math.round(safeValue(waterLevel, 0)), -40, 40),
      waterRoughness: this.clamp(Math.round(safeValue(waterRoughness, 50)), 0, 100),
    };
    this.drawVoronoiTerrain();
  }

  start(onFrame?: (deltaMs: number, now: number) => void): void {
    if (!this.app || !this.engine) {
      return;
    }
    this.app.ticker.add((ticker: { deltaMS: number }) => {
      window.Matter.Engine.update(this.engine, ticker.deltaMS);
      this.updateEntities(ticker.deltaMS);
      if (onFrame) {
        onFrame(ticker.deltaMS, performance.now());
      }
    });
  }

  spawnBox(x: number, y: number): void {
    if (!this.engine || !this.app || !window.Matter || !window.PIXI) {
      return;
    }
    const size = 24 + Math.random() * 32;
    const { Bodies, Body } = window.Matter;
    const colliderSize = size * this.config.colliderScale;
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

    const graphic = new window.PIXI.Graphics();
    graphic.roundRect(-size / 2, -size / 2, size, size, Math.min(10, size / 3));
    graphic.fill({ color: 0x57b9ff, alpha: 0.9 });
    graphic.stroke({ width: 2, color: 0x0b0e12, alpha: 0.8 });
    graphic.x = x;
    graphic.y = y;

    this.createPhysicsEntity(body, graphic);
  }

  spawnTextBox(
    text: string,
    color: string,
    emoji: string,
    spawnPosition?: { x: number; y: number }
  ): void {
    if (!this.engine || !this.app || !window.Matter || !window.PIXI) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const style = new window.PIXI.TextStyle({
      fontFamily: '"Inter", "Segoe UI", sans-serif',
      fontSize: 28,
      fill: color || '#f5f5f5',
      fontWeight: '600',
      wordWrap: true,
      wordWrapWidth: this.config.width - 80,
    });
    const textSprite = new window.PIXI.Text(trimmed, style);
    if (textSprite.anchor && textSprite.anchor.set) {
      textSprite.anchor.set(0.5);
    }

    const boxWidth = textSprite.width;
    const boxHeight = textSprite.height;
    const position = spawnPosition || { x: this.config.width / 2, y: this.config.height / 4 };
    const x = position.x;
    const y = position.y;
    const { Bodies, Body } = window.Matter;
    const body = Bodies.rectangle(x, y, boxWidth * this.config.colliderScale, boxHeight * this.config.colliderScale, {
      restitution: 0.5,
      friction: 0.4,
      density: 0.0025,
    });
    Body.setVelocity(body, {
      x: (Math.random() - 0.5) * 2.5,
      y: (Math.random() - 0.5) * 2.5,
    });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);

    const container = new window.PIXI.Container();
    const background = new window.PIXI.Graphics();
    background.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
    background.fill({ color: 0x0b0e12, alpha: 1 });
    container.addChild(background);
    textSprite.x = 0;
    textSprite.y = 0;
    container.addChild(textSprite);
    container.x = x;
    container.y = y;

    this.createPhysicsEntity(body, container);
  }

  renderPlayers(players: PlayerState[]): void {
    if (!this.layers.ui || !window.PIXI) {
      return;
    }
    const uiLayer = this.layers.ui;
    uiLayer.removeChildren();
    this.typingPositions.clear();
    players.forEach((player, index) => {
      const style = new window.PIXI.TextStyle({
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        fontSize: 28,
        fill: player.color || '#f5f5f5',
      });
      const avatar = (player.emoji || '\ud83e\udd34') + ':';
      const typingText = player.typing ? ' ' + player.typing : '';
      const row = new window.PIXI.Container();
      const avatarText = new window.PIXI.Text(avatar, style);
      const typingSprite = new window.PIXI.Text(typingText, style);
      typingSprite.x = avatarText.width;
      row.addChild(avatarText);
      row.addChild(typingSprite);
      row.x = 0;
      row.y = index * 36;
      uiLayer.addChild(row);
      this.typingPositions.set(player.id, {
        x: uiLayer.x + row.x + avatarText.width + typingSprite.width / 2,
        y: uiLayer.y + row.y + avatarText.height / 2,
      });
    });
  }

  getTypingPosition(id: string): { x: number; y: number } | undefined {
    return this.typingPositions.get(id);
  }

  getHistorySpawnPosition(index: number, total: number): { x: number; y: number } {
    const clampedTotal = Math.max(1, total);
    const lowerBound = this.config.height - 140;
    const upperBound = 140;
    const progress = clampedTotal === 1 ? 0 : index / (clampedTotal - 1);
    const y = lowerBound - progress * (lowerBound - upperBound);
    const jitter = 24;
    return {
      x: this.config.width / 2 + (Math.random() - 0.5) * jitter,
      y: y + (Math.random() - 0.5) * jitter,
    };
  }

  private drawVoronoiTerrain(): void {
    if (!this.layers.terrain || !window.PIXI) {
      return;
    }
    const terrainLayer = this.layers.terrain;
    terrainLayer.removeChildren();

    const waterTint = new window.PIXI.Graphics();
    waterTint.rect(0, 0, this.config.width, this.config.height);
    waterTint.fill({ color: 0x0d1a2e, alpha: 0.18 });
    terrainLayer.addChild(waterTint);

    const seed = this.terrainControls.seed >>> 0;
    const random = this.createRng(seed);
    const padding = 28;
    const sites = this.generatePoissonSites(
      this.terrainControls.pointCount,
      this.terrainControls.spacing,
      padding,
      random
    );
    const cells: Vec2[][] = new Array(sites.length);
    sites.forEach((site, index) => {
      cells[index] = this.buildVoronoiCell(site, sites);
    });

    const graph = this.buildMapGraph(sites, cells);
    this.assignIslandWater(
      graph,
      cells,
      random,
      this.terrainControls.waterLevel,
      this.terrainControls.waterRoughness
    );
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
      terrain.poly(this.flattenPolygon(cell), true);
      terrain.fill({ color: fillColor, alpha: fillAlpha });
      terrain.stroke({ width: 1.2, color: strokeColor, alpha: strokeAlpha });
      terrainLayer.addChild(terrain);
    });

    if (this.terrainControls.showGraphs) {
      this.drawGraphOverlay(graph, terrainLayer);
    }
  }

  private generatePoissonSites(targetCount: number, spacing: number, padding: number, random: () => number): Vec2[] {
    let minDistance = spacing;
    for (let pass = 0; pass < 6; pass += 1) {
      const sites = this.samplePoissonDisc(targetCount, minDistance, padding, random);
      if (sites.length >= targetCount || minDistance <= 4) {
        return sites;
      }
      minDistance *= 0.88;
    }
    return this.samplePoissonDisc(targetCount, Math.max(4, spacing * 0.6), padding, random);
  }

  private samplePoissonDisc(targetCount: number, minDistance: number, padding: number, random: () => number): Vec2[] {
    const maxAttemptsPerActivePoint = 30;
    const width = this.config.width - padding * 2;
    const height = this.config.height - padding * 2;
    if (width <= 0 || height <= 0 || targetCount <= 0) {
      return [];
    }

    const cellSize = minDistance / Math.sqrt(2);
    const gridWidth = Math.max(1, Math.ceil(width / cellSize));
    const gridHeight = Math.max(1, Math.ceil(height / cellSize));
    const grid = new Array<number>(gridWidth * gridHeight).fill(-1);
    const points: Vec2[] = [];
    const active: number[] = [];
    const centerX = this.config.width / 2;
    const centerY = this.config.height / 2;
    const clusterCount = 3 + Math.floor(random() * 3);
    const anchorRingRadius = Math.min(width, height) * 0.18;
    const clusterAnchors: Vec2[] = [];

    const toGridX = (x: number): number => Math.floor((x - padding) / cellSize);
    const toGridY = (y: number): number => Math.floor((y - padding) / cellSize);
    const isInBounds = (point: Vec2): boolean =>
      point.x >= padding &&
      point.x <= this.config.width - padding &&
      point.y >= padding &&
      point.y <= this.config.height - padding;

    const registerPoint = (point: Vec2): void => {
      points.push(point);
      const index = points.length - 1;
      active.push(index);
      const gx = this.clamp(toGridX(point.x), 0, gridWidth - 1);
      const gy = this.clamp(toGridY(point.y), 0, gridHeight - 1);
      grid[gy * gridWidth + gx] = index;
    };

    const isFarEnough = (point: Vec2): boolean => {
      if (!isInBounds(point)) {
        return false;
      }
      const gx = this.clamp(toGridX(point.x), 0, gridWidth - 1);
      const gy = this.clamp(toGridY(point.y), 0, gridHeight - 1);
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

    for (let i = 0; i < clusterCount; i += 1) {
      const angle = (i / clusterCount) * Math.PI * 2 + random() * 0.9;
      const radius = random() * anchorRingRadius;
      clusterAnchors.push({
        x: this.clamp(centerX + Math.cos(angle) * radius, padding, this.config.width - padding),
        y: this.clamp(centerY + Math.sin(angle) * radius, padding, this.config.height - padding),
      });
    }

    const coverageAnchors: Vec2[] = [
      { x: padding, y: padding },
      { x: this.config.width / 2, y: padding },
      { x: this.config.width - padding, y: padding },
      { x: padding, y: this.config.height / 2 },
      { x: this.config.width - padding, y: this.config.height / 2 },
      { x: padding, y: this.config.height - padding },
      { x: this.config.width / 2, y: this.config.height - padding },
      { x: this.config.width - padding, y: this.config.height - padding },
    ];

    const seedAnchors = clusterAnchors.concat(coverageAnchors);
    for (let i = 0; i < seedAnchors.length && points.length < targetCount; i += 1) {
      const seedPoint = seedAnchors[i];
      if (isFarEnough(seedPoint)) {
        registerPoint(seedPoint);
      }
    }
    if (points.length === 0) {
      registerPoint({ x: centerX, y: centerY });
    }

    while (active.length > 0 && points.length < targetCount) {
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

  private buildVoronoiCell(site: Vec2, sites: Vec2[]): Vec2[] {
    let polygon: Vec2[] = [
      { x: 0, y: 0 },
      { x: this.config.width, y: 0 },
      { x: this.config.width, y: this.config.height },
      { x: 0, y: this.config.height },
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
      polygon = this.clipPolygonWithHalfPlane(polygon, midpoint, normal);
      if (polygon.length < 3) {
        return [];
      }
    }

    return polygon;
  }

  private clipPolygonWithHalfPlane(polygon: Vec2[], midpoint: Vec2, normal: Vec2): Vec2[] {
    if (polygon.length === 0) {
      return [];
    }
    const clipped: Vec2[] = [];
    const epsilon = 1e-6;

    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const currentValue = this.evaluateLine(current, midpoint, normal);
      const nextValue = this.evaluateLine(next, midpoint, normal);
      const currentInside = currentValue <= epsilon;
      const nextInside = nextValue <= epsilon;

      if (currentInside && nextInside) {
        clipped.push(next);
      } else if (currentInside && !nextInside) {
        clipped.push(this.intersectSegmentWithLine(current, next, midpoint, currentValue, nextValue));
      } else if (!currentInside && nextInside) {
        clipped.push(this.intersectSegmentWithLine(current, next, midpoint, currentValue, nextValue));
        clipped.push(next);
      }
    }

    return clipped;
  }

  private evaluateLine(point: Vec2, midpoint: Vec2, normal: Vec2): number {
    return (point.x - midpoint.x) * normal.x + (point.y - midpoint.y) * normal.y;
  }

  private intersectSegmentWithLine(
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

  private flattenPolygon(polygon: Vec2[]): number[] {
    const flat: number[] = [];
    for (let i = 0; i < polygon.length; i += 1) {
      flat.push(polygon[i].x, polygon[i].y);
    }
    return flat;
  }

  private buildMapGraph(sites: Vec2[], cells: Vec2[][]): MapGraph {
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
        this.pushUnique(corners[cornerIndex].centers, centerIndex);
        this.pushUnique(center.corners, cornerIndex);
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
        this.pushUnique(center.borders, borderIndex);
      }
    });

    edges.forEach((edge) => {
      const [cornerA, cornerB] = edge.corners;
      this.pushUnique(corners[cornerA].adjacent, cornerB);
      this.pushUnique(corners[cornerB].adjacent, cornerA);
      this.pushUnique(corners[cornerA].protrudes, edge.index);
      this.pushUnique(corners[cornerB].protrudes, edge.index);

      const [centerA, centerB] = edge.centers;
      if (centerA >= 0) {
        this.pushUnique(centers[centerA].borders, edge.index);
      }
      if (centerB >= 0) {
        this.pushUnique(centers[centerB].borders, edge.index);
      }
      if (centerA >= 0 && centerB >= 0) {
        this.pushUnique(centers[centerA].neighbors, centerB);
        this.pushUnique(centers[centerB].neighbors, centerA);
      }
    });

    return { centers, corners, edges };
  }

  private assignIslandWater(
    graph: MapGraph,
    cells: Vec2[][],
    random: () => number,
    waterLevel: number,
    waterRoughness: number
  ): void {
    const width = this.config.width;
    const height = this.config.height;
    const normalizedWaterLevel = this.clamp(waterLevel, -40, 40) / 40;
    const normalizedRoughness = this.clamp(waterRoughness, 0, 100) / 100;
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
      const radius = this.clamp(
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

  private drawGraphOverlay(graph: MapGraph, terrainLayer: any): void {
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

  private pushUnique(values: number[], value: number): void {
    if (!values.includes(value)) {
      values.push(value);
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private createRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  private setupPhysics(): void {
    if (!window.Matter || !this.app) {
      return;
    }
    const { Engine, Bodies, World } = window.Matter;
    const engine = Engine.create({
      gravity: { x: 0, y: 1 },
    });
    this.engine = engine;

    const wallThickness = 120;
    const boundaries = [
      Bodies.rectangle(
        this.config.width / 2,
        this.config.height + wallThickness / 2,
        this.config.width + wallThickness * 2,
        wallThickness,
        { isStatic: true }
      ),
      Bodies.rectangle(
        this.config.width / 2,
        -wallThickness / 2,
        this.config.width + wallThickness * 2,
        wallThickness,
        { isStatic: true }
      ),
      Bodies.rectangle(
        -wallThickness / 2,
        this.config.height / 2,
        wallThickness,
        this.config.height + wallThickness * 2,
        { isStatic: true }
      ),
      Bodies.rectangle(
        this.config.width + wallThickness / 2,
        this.config.height / 2,
        wallThickness,
        this.config.height + wallThickness * 2,
        { isStatic: true }
      ),
    ];
    World.add(engine.world, boundaries);
  }

  private createPhysicsEntity(body: any, display: any): GameEntity | null {
    if (!this.engine || !this.layers.world) {
      return null;
    }
    window.Matter.World.add(this.engine.world, body);
    this.layers.world.addChild(display);
    const entity: GameEntity = {
      update() {
        display.x = body.position.x;
        display.y = body.position.y;
        display.rotation = body.angle;
      },
      destroy: (currentGame) => {
        if (currentGame.engine) {
          window.Matter.World.remove(currentGame.engine.world, body);
        }
        if (display.removeFromParent) {
          display.removeFromParent();
        }
      },
    };
    this.entities.add(entity);
    return entity;
  }

  private updateEntities(deltaMs: number): void {
    this.entities.forEach((entity) => {
      if (entity.update) {
        entity.update(deltaMs, this);
      }
    });
  }
}
