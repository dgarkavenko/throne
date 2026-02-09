import {
  createRng,
  renderTerrain as renderTerrainLayer,
  terrainBasegen,
  terrainRefine,
  updateProvinceBorders,
  type TerrainBasegenResult,
  type TerrainControls,
  type TerrainRefineResult,
} from './terrain';
import { basegenPolitical, type ProvinceGraph } from './political';
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

type TerrainGenerationState = {
  base: TerrainBasegenResult;
  provinceGraph: ProvinceGraph;
  refined: TerrainRefineResult;
};

type Vec2 = { x: number; y: number };

type ProvinceInteractionModel = {
  facePolygons: Vec2[][];
  faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
  gridSize: number;
  gridColumns: number;
  gridRows: number;
  grid: Map<number, number[]>;
  provinceByFace: number[];
  isLand: boolean[];
  provinceCentroids: Array<Vec2 | null>;
  provinceBorderPaths: Vec2[][][];
};

type ProvinceInteractionOverlay = {
  container: any;
  hoverGraphics: any;
  selectedGraphics: any;
  neighborGraphics: any;
};

type MeshOverlay = {
  container: any;
  polygonGraph: any;
  dualGraph: any;
  cornerNodes: any;
  centerNodes: any;
  insertedNodes: any;
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
  private terrainState: TerrainGenerationState | null = null;
  private meshOverlay: MeshOverlay | null = null;
  private provinceInteractionModel: ProvinceInteractionModel | null = null;
  private provinceInteractionOverlay: ProvinceInteractionOverlay | null = null;
  private hoveredProvinceId: number | null = null;
  private selectedProvinceId: number | null = null;
  private selectionListeners = new Set<(provinceId: number | null) => void>();
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private pointerLeaveHandler: ((event: PointerEvent) => void) | null = null;
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private terrainControls: TerrainControls = {
    spacing: 32,
    showPolygonGraph: false,
    showDualGraph: false,
    showCornerNodes: false,
    showCenterNodes: false,
    showInsertedPoints: false,
    provinceCount: 8,
    provinceBorderWidth: 6.5,
      showLandBorders: true,
      showShoreBorders: true,
      landRelief: 0.95,
      ridgeStrength: 0.85,
      ridgeCount: 9,
      plateauStrength: 0.8,
      ridgeDistribution: 0.8,
      ridgeSeparation: 0.95,
      ridgeContinuity: 0.25,
      ridgeContinuityThreshold: 0,
      oceanPeakClamp: 0.05,
      ridgeOceanClamp: 0.5,
      ridgeWidth: 1,
    seed: 1337,
    intermediateSeed: 1337,
    intermediateMaxIterations: 8,
    intermediateThreshold: 5,
    intermediateRelMagnitude: 0,
    intermediateAbsMagnitude: 2,
    waterLevel: -10,
    waterRoughness: 60,
    waterNoiseScale: 2,
    waterNoiseStrength: 0,
    waterNoiseOctaves: 1,
    waterWarpScale: 2,
    waterWarpStrength: 0.7,
    riverDensity: 1,
    riverBranchChance: 0.25,
    riverClimbChance: 0.35,
  };
  private hasTerrain = false;

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

    this.regenerateTerrain();
    this.setupPhysics();
    this.setupProvinceInteractionEvents();
  }

  setVoronoiControls(nextControls: TerrainControls): void {
    const safeValue = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);
    const sanitized: TerrainControls = {
      spacing: this.clamp(Math.round(safeValue(nextControls.spacing, 32)), 16, 128),
      showPolygonGraph: Boolean(nextControls.showPolygonGraph),
      showDualGraph: Boolean(nextControls.showDualGraph),
      showCornerNodes: Boolean(nextControls.showCornerNodes),
      showCenterNodes: Boolean(nextControls.showCenterNodes),
      showInsertedPoints: Boolean(nextControls.showInsertedPoints),
      provinceCount: this.clamp(Math.round(safeValue(nextControls.provinceCount, 8)), 1, 32),
      provinceBorderWidth: this.clamp(safeValue(nextControls.provinceBorderWidth, 6.5), 1, 24),
      showLandBorders: Boolean(nextControls.showLandBorders),
      showShoreBorders: Boolean(nextControls.showShoreBorders),
      landRelief: this.clamp(Math.round(safeValue(nextControls.landRelief, 0.95) * 100) / 100, 0, 1),
      ridgeStrength: this.clamp(Math.round(safeValue(nextControls.ridgeStrength, 0.85) * 100) / 100, 0, 1),
      ridgeCount: this.clamp(Math.round(safeValue(nextControls.ridgeCount, 9)), 1, 10),
      plateauStrength: this.clamp(Math.round(safeValue(nextControls.plateauStrength, 0.8) * 100) / 100, 0, 1),
      ridgeDistribution: this.clamp(Math.round(safeValue(nextControls.ridgeDistribution, 0.8) * 100) / 100, 0, 1),
      ridgeSeparation: this.clamp(Math.round(safeValue(nextControls.ridgeSeparation, 0.95) * 100) / 100, 0, 1),
      ridgeContinuity: this.clamp(Math.round(safeValue(nextControls.ridgeContinuity, 0.25) * 100) / 100, 0, 1),
      ridgeContinuityThreshold: this.clamp(
        Math.round(safeValue(nextControls.ridgeContinuityThreshold, 0) * 100) / 100,
        0,
        1
      ),
      oceanPeakClamp: this.clamp(Math.round(safeValue(nextControls.oceanPeakClamp, 0.05) * 100) / 100, 0, 1),
      ridgeOceanClamp: this.clamp(Math.round(safeValue(nextControls.ridgeOceanClamp, 0.5) * 100) / 100, 0, 1),
      ridgeWidth: this.clamp(Math.round(safeValue(nextControls.ridgeWidth, 1) * 100) / 100, 0, 1),
      seed: this.clamp(Math.floor(safeValue(nextControls.seed, 1337)), 0, 0xffffffff),
      intermediateSeed: this.clamp(Math.floor(safeValue(nextControls.intermediateSeed, 1337)), 0, 0xffffffff),
      intermediateMaxIterations: this.clamp(Math.round(safeValue(nextControls.intermediateMaxIterations, 8)), 0, 12),
      intermediateThreshold: this.clamp(Math.round(safeValue(nextControls.intermediateThreshold, 5)), 2, 20),
      intermediateRelMagnitude: this.clamp(
        Math.round(safeValue(nextControls.intermediateRelMagnitude, 1) * 10) / 10,
        0,
        2
      ),
      intermediateAbsMagnitude: this.clamp(Math.round(safeValue(nextControls.intermediateAbsMagnitude, 2)), 0, 10),
      waterLevel: this.clamp(Math.round(safeValue(nextControls.waterLevel, -10)), -40, 40),
      waterRoughness: this.clamp(Math.round(safeValue(nextControls.waterRoughness, 60)), 0, 100),
      waterNoiseScale: this.clamp(Math.round(safeValue(nextControls.waterNoiseScale, 2)), 2, 60),
      waterNoiseStrength: this.clamp(Math.round(safeValue(nextControls.waterNoiseStrength, 0) * 100) / 100, 0, 1),
      waterNoiseOctaves: this.clamp(Math.round(safeValue(nextControls.waterNoiseOctaves, 1)), 1, 6),
      waterWarpScale: this.clamp(Math.round(safeValue(nextControls.waterWarpScale, 2)), 2, 40),
      waterWarpStrength: this.clamp(Math.round(safeValue(nextControls.waterWarpStrength, 0.7) * 100) / 100, 0, 0.8),
      riverDensity: this.clamp(Math.round(safeValue(nextControls.riverDensity, 1) * 10) / 10, 0, 2),
      riverBranchChance: this.clamp(Math.round(safeValue(nextControls.riverBranchChance, 0.25) * 100) / 100, 0, 1),
      riverClimbChance: this.clamp(Math.round(safeValue(nextControls.riverClimbChance, 0.35) * 100) / 100, 0, 1),
    };

    const needsRegeneration =
      !this.hasTerrain ||
      this.terrainControls.spacing !== sanitized.spacing ||
      this.terrainControls.seed !== sanitized.seed ||
      this.terrainControls.intermediateSeed !== sanitized.intermediateSeed ||
      this.terrainControls.intermediateMaxIterations !== sanitized.intermediateMaxIterations ||
      this.terrainControls.intermediateThreshold !== sanitized.intermediateThreshold ||
      this.terrainControls.intermediateRelMagnitude !== sanitized.intermediateRelMagnitude ||
      this.terrainControls.intermediateAbsMagnitude !== sanitized.intermediateAbsMagnitude ||
      this.terrainControls.provinceCount !== sanitized.provinceCount ||
      this.terrainControls.landRelief !== sanitized.landRelief ||
      this.terrainControls.ridgeStrength !== sanitized.ridgeStrength ||
      this.terrainControls.ridgeCount !== sanitized.ridgeCount ||
      this.terrainControls.plateauStrength !== sanitized.plateauStrength ||
      this.terrainControls.ridgeDistribution !== sanitized.ridgeDistribution ||
      this.terrainControls.ridgeSeparation !== sanitized.ridgeSeparation ||
      this.terrainControls.ridgeContinuity !== sanitized.ridgeContinuity ||
      this.terrainControls.ridgeContinuityThreshold !== sanitized.ridgeContinuityThreshold ||
      this.terrainControls.oceanPeakClamp !== sanitized.oceanPeakClamp ||
      this.terrainControls.ridgeOceanClamp !== sanitized.ridgeOceanClamp ||
      this.terrainControls.ridgeWidth !== sanitized.ridgeWidth ||
      this.terrainControls.waterLevel !== sanitized.waterLevel ||
      this.terrainControls.waterRoughness !== sanitized.waterRoughness ||
      this.terrainControls.waterNoiseScale !== sanitized.waterNoiseScale ||
      this.terrainControls.waterNoiseStrength !== sanitized.waterNoiseStrength ||
      this.terrainControls.waterNoiseOctaves !== sanitized.waterNoiseOctaves ||
      this.terrainControls.waterWarpScale !== sanitized.waterWarpScale ||
      this.terrainControls.waterWarpStrength !== sanitized.waterWarpStrength ||
      this.terrainControls.riverDensity !== sanitized.riverDensity ||
      this.terrainControls.riverBranchChance !== sanitized.riverBranchChance ||
      this.terrainControls.riverClimbChance !== sanitized.riverClimbChance;

    this.terrainControls = sanitized;

    if (needsRegeneration) {
      this.regenerateTerrain();
      return;
    }
    if (this.layers.terrain) {
      updateProvinceBorders(this.layers.terrain, this.terrainControls);
      this.setGraphOverlayVisibility(this.terrainControls);
      this.renderProvinceInteractionOverlay();
    }
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

  getTerrainState(): TerrainGenerationState | null {
    return this.terrainState;
  }

  getHoveredProvinceId(): number | null {
    return this.hoveredProvinceId;
  }

  getSelectedProvinceId(): number | null {
    return this.selectedProvinceId;
  }

  onProvinceSelectionChange(listener: (provinceId: number | null) => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
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

  private generateTerrainState(): TerrainGenerationState {
    const config = { width: this.config.width, height: this.config.height };
    const seed = this.terrainControls.seed >>> 0;
    const random = createRng(seed);
    const intermediateRandom = createRng(this.terrainControls.intermediateSeed >>> 0);
    const riverSeed = (this.terrainControls.seed ^ 0x9e3779b9) >>> 0;
    const riverRandom = createRng(riverSeed);
    const base = terrainBasegen(config, this.terrainControls, random);
    const provinceGraph = basegenPolitical(base.mesh, this.terrainControls, random, base.isLand);
    const refined = terrainRefine(
      base.mesh,
      provinceGraph,
      this.terrainControls,
      intermediateRandom,
      riverRandom,
      base.isLand,
      base.oceanWater
    );

    return { base, provinceGraph, refined };
  }

  private renderTerrainState(state: TerrainGenerationState): void {
    if (!this.layers.terrain) {
      return;
    }
    const config = { width: this.config.width, height: this.config.height };
    renderTerrainLayer(config, this.terrainControls, this.layers.terrain, state.base, state.provinceGraph, state.refined);
    const overlay = this.ensureMeshOverlay(this.layers.terrain);
    this.renderMeshOverlay(state.base.mesh, state.refined.refinedGeometry.insertedPoints, overlay);
    this.setGraphOverlayVisibility(this.terrainControls);
  }

  private regenerateTerrain(): void {
    if (!this.layers.terrain) {
      return;
    }
    const state = this.generateTerrainState();
    this.terrainState = state;
    this.renderTerrainState(state);
    this.rebuildProvinceInteractionModel();
    this.renderProvinceInteractionOverlay();
    this.hasTerrain = true;
  }

  private setupProvinceInteractionEvents(): void {
    if (!this.app) {
      return;
    }
    const canvas = this.app.canvas ?? this.app.view;
    if (!canvas || !canvas.addEventListener) {
      return;
    }
    if (this.pointerMoveHandler) {
      canvas.removeEventListener('pointermove', this.pointerMoveHandler);
    }
    if (this.pointerLeaveHandler) {
      canvas.removeEventListener('pointerleave', this.pointerLeaveHandler);
    }
    if (this.pointerDownHandler) {
      canvas.removeEventListener('pointerdown', this.pointerDownHandler);
    }

    this.pointerMoveHandler = (event: PointerEvent) => {
      const position = this.getPointerWorldPosition(event);
      if (!position) {
        return;
      }
      const nextHover = this.pickProvinceAt(position.x, position.y);
      this.setHoveredProvince(nextHover);
    };
    this.pointerLeaveHandler = () => {
      this.setHoveredProvince(null);
    };
    this.pointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const position = this.getPointerWorldPosition(event);
      if (!position) {
        return;
      }
      const nextSelection = this.pickProvinceAt(position.x, position.y);
      this.setSelectedProvince(nextSelection);
    };

    canvas.addEventListener('pointermove', this.pointerMoveHandler);
    canvas.addEventListener('pointerleave', this.pointerLeaveHandler);
    canvas.addEventListener('pointerdown', this.pointerDownHandler);
  }

  private rebuildProvinceInteractionModel(): void {
    if (!this.terrainState) {
      this.provinceInteractionModel = null;
      return;
    }
    const { base, provinceGraph, refined } = this.terrainState;
    const mesh = base.mesh;
    const { refinedGeometry } = refined;
    const faceCount = mesh.faces.length;
    const facePolygons: Vec2[][] = new Array(faceCount);
    const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
    const gridSize = Math.max(32, this.terrainControls.spacing * 2);
    const gridColumns = Math.max(1, Math.ceil(this.config.width / gridSize));
    const gridRows = Math.max(1, Math.ceil(this.config.height / gridSize));
    const grid = new Map<number, number[]>();

    for (let i = 0; i < faceCount; i += 1) {
      const refinedCell = refinedGeometry.refinedCells[i];
      const baseCell = base.baseCells[i];
      const cell = refinedCell && refinedCell.length >= 3 ? refinedCell : baseCell;
      if (!cell || cell.length < 3) {
        facePolygons[i] = [];
        faceAabbs[i] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        continue;
      }
      facePolygons[i] = cell;
      let minX = cell[0].x;
      let maxX = cell[0].x;
      let minY = cell[0].y;
      let maxY = cell[0].y;
      for (let j = 1; j < cell.length; j += 1) {
        const point = cell[j];
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      faceAabbs[i] = { minX, minY, maxX, maxY };
      const startX = Math.max(0, Math.floor(minX / gridSize));
      const endX = Math.min(gridColumns - 1, Math.floor(maxX / gridSize));
      const startY = Math.max(0, Math.floor(minY / gridSize));
      const endY = Math.min(gridRows - 1, Math.floor(maxY / gridSize));
      for (let gx = startX; gx <= endX; gx += 1) {
        for (let gy = startY; gy <= endY; gy += 1) {
          const key = gx + gy * gridColumns;
          const bucket = grid.get(key);
          if (bucket) {
            bucket.push(i);
          } else {
            grid.set(key, [i]);
          }
        }
      }
    }

    const provinceCentroids: Array<Vec2 | null> = new Array(provinceGraph.faces.length).fill(null);
    provinceGraph.faces.forEach((province, index) => {
      if (!province.faces || province.faces.length === 0) {
        provinceCentroids[index] = null;
        return;
      }
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      province.faces.forEach((faceIndex) => {
        const point = mesh.faces[faceIndex]?.point;
        if (!point) {
          return;
        }
        sumX += point.x;
        sumY += point.y;
        count += 1;
      });
      provinceCentroids[index] = count > 0 ? { x: sumX / count, y: sumY / count } : null;
    });

    const provinceBorderPaths: Vec2[][][] = new Array(provinceGraph.faces.length);
    provinceGraph.faces.forEach((province, index) => {
      const segments: Vec2[][] = [];
      province.outerEdges.forEach((edgeIndex) => {
        const outerEdge = provinceGraph.outerEdges[edgeIndex];
        const polyline = refinedGeometry.edgePolylines[outerEdge.edge];
        if (polyline && polyline.length > 1) {
          segments.push(polyline);
        }
      });
      provinceBorderPaths[index] = segments;
    });

    this.provinceInteractionModel = {
      facePolygons,
      faceAabbs,
      gridSize,
      gridColumns,
      gridRows,
      grid,
      provinceByFace: provinceGraph.provinceByFace,
      isLand: provinceGraph.isLand,
      provinceCentroids,
      provinceBorderPaths,
    };
    this.hoveredProvinceId = null;
    this.selectedProvinceId = null;
  }

  private ensureProvinceInteractionOverlay(): ProvinceInteractionOverlay | null {
    if (!this.layers.terrain || !window.PIXI) {
      return null;
    }
    if (this.provinceInteractionOverlay) {
      const meshIndex = this.meshOverlay?.container
        ? this.layers.terrain.children.indexOf(this.meshOverlay.container)
        : -1;
      if (meshIndex >= 0) {
        const targetIndex = Math.max(0, meshIndex - 1);
        this.layers.terrain.setChildIndex(this.provinceInteractionOverlay.container, targetIndex);
      }
      return this.provinceInteractionOverlay;
    }
    const container = new window.PIXI.Container();
    const neighborGraphics = new window.PIXI.Graphics();
    const hoverGraphics = new window.PIXI.Graphics();
    const selectedGraphics = new window.PIXI.Graphics();
    container.addChild(neighborGraphics);
    container.addChild(hoverGraphics);
    container.addChild(selectedGraphics);
    const meshIndex = this.meshOverlay?.container
      ? this.layers.terrain.children.indexOf(this.meshOverlay.container)
      : -1;
    if (meshIndex >= 0) {
      this.layers.terrain.addChildAt(container, Math.max(0, meshIndex));
    } else {
      this.layers.terrain.addChild(container);
    }
    this.provinceInteractionOverlay = { container, hoverGraphics, selectedGraphics, neighborGraphics };
    return this.provinceInteractionOverlay;
  }

  private renderProvinceInteractionOverlay(): void {
    const overlay = this.ensureProvinceInteractionOverlay();
    if (!overlay || !this.provinceInteractionModel) {
      return;
    }
    overlay.hoverGraphics.clear();
    overlay.selectedGraphics.clear();
    overlay.neighborGraphics.clear();

    const borderWidth = this.terrainControls.provinceBorderWidth;
    const hoverWidth = Math.max(1, borderWidth * 0.6);
    const selectedWidth = Math.max(2, borderWidth * 0.95);

    if (this.hoveredProvinceId !== null) {
      const segments = this.provinceInteractionModel.provinceBorderPaths[this.hoveredProvinceId];
      if (segments && segments.length > 0) {
        this.drawProvinceBorder(overlay.hoverGraphics, segments, 0xdcecff, 0.5, hoverWidth);
      }
    }

    if (this.selectedProvinceId !== null) {
      const segments = this.provinceInteractionModel.provinceBorderPaths[this.selectedProvinceId];
      if (segments && segments.length > 0) {
        this.drawProvinceBorder(overlay.selectedGraphics, segments, 0xffffff, 0.95, selectedWidth);
      }
      const center = this.provinceInteractionModel.provinceCentroids[this.selectedProvinceId];
      const neighbors = this.terrainState?.provinceGraph.faces[this.selectedProvinceId]?.adjacentProvinces ?? [];
      if (center && neighbors.length > 0) {
        neighbors.forEach((neighborId) => {
          const neighborCenter = this.provinceInteractionModel?.provinceCentroids[neighborId];
          if (!neighborCenter) {
            return;
          }
          overlay.neighborGraphics.moveTo(center.x, center.y);
          overlay.neighborGraphics.lineTo(neighborCenter.x, neighborCenter.y);
        });
        overlay.neighborGraphics.stroke({ width: Math.max(1.5, borderWidth * 0.5), color: 0xffffff, alpha: 0.6 });
      }
    }
  }

  private drawProvinceBorder(
    graphics: any,
    segments: Vec2[][],
    color: number,
    alpha: number,
    width: number
  ): void {
    segments.forEach((segment) => {
      if (!segment || segment.length < 2) {
        return;
      }
      graphics.moveTo(segment[0].x, segment[0].y);
      for (let i = 1; i < segment.length; i += 1) {
        graphics.lineTo(segment[i].x, segment[i].y);
      }
    });
    graphics.stroke({ width, color, alpha });
  }

  private pickProvinceAt(worldX: number, worldY: number): number | null {
    const model = this.provinceInteractionModel;
    if (!model) {
      return null;
    }
    const gridX = Math.floor(worldX / model.gridSize);
    const gridY = Math.floor(worldY / model.gridSize);
    if (gridX < 0 || gridY < 0 || gridX >= model.gridColumns || gridY >= model.gridRows) {
      return null;
    }
    const key = gridX + gridY * model.gridColumns;
    const candidates = model.grid.get(key);
    if (!candidates || candidates.length === 0) {
      return null;
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const faceIndex = candidates[i];
      const bounds = model.faceAabbs[faceIndex];
      if (
        worldX < bounds.minX ||
        worldX > bounds.maxX ||
        worldY < bounds.minY ||
        worldY > bounds.maxY
      ) {
        continue;
      }
      const polygon = model.facePolygons[faceIndex];
      if (!polygon || polygon.length < 3) {
        continue;
      }
      if (!this.pointInPolygon(worldX, worldY, polygon)) {
        continue;
      }
      if (!model.isLand[faceIndex]) {
        return null;
      }
      const provinceId = model.provinceByFace[faceIndex];
      return provinceId >= 0 ? provinceId : null;
    }
    return null;
  }

  private pointInPolygon(x: number, y: number, polygon: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  private getPointerWorldPosition(event: PointerEvent): Vec2 | null {
    if (!this.app) {
      return null;
    }
    const canvas = this.app.canvas ?? this.app.view;
    if (!canvas || !canvas.getBoundingClientRect) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const scaleX = this.config.width / rect.width;
    const scaleY = this.config.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private setHoveredProvince(provinceId: number | null): void {
    if (this.hoveredProvinceId === provinceId) {
      return;
    }
    this.hoveredProvinceId = provinceId;
    this.renderProvinceInteractionOverlay();
  }

  private setSelectedProvince(provinceId: number | null): void {
    if (this.selectedProvinceId === provinceId) {
      return;
    }
    this.selectedProvinceId = provinceId;
    this.renderProvinceInteractionOverlay();
    this.selectionListeners.forEach((listener) => listener(provinceId));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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

  private ensureMeshOverlay(terrainLayer: any): MeshOverlay {
    if (this.meshOverlay) {
      terrainLayer.setChildIndex(this.meshOverlay.container, terrainLayer.children.length - 1);
      return this.meshOverlay;
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
    this.meshOverlay = { container, polygonGraph, dualGraph, cornerNodes, centerNodes, insertedNodes };
    return this.meshOverlay;
  }

  private setGraphOverlayVisibility(controls: TerrainControls): void {
    if (!this.meshOverlay) {
      return;
    }
    this.meshOverlay.polygonGraph.visible = controls.showPolygonGraph;
    this.meshOverlay.dualGraph.visible = controls.showDualGraph;
    this.meshOverlay.cornerNodes.visible = controls.showCornerNodes;
    this.meshOverlay.centerNodes.visible = controls.showCenterNodes;
    this.meshOverlay.insertedNodes.visible = controls.showInsertedPoints;
    this.meshOverlay.container.visible =
      controls.showPolygonGraph ||
      controls.showDualGraph ||
      controls.showCornerNodes ||
      controls.showCenterNodes ||
      controls.showInsertedPoints;
  }

  private renderMeshOverlay(mesh: any, insertedPoints: Array<{ x: number; y: number }>, overlay: MeshOverlay): void {
    overlay.polygonGraph.clear();
    overlay.dualGraph.clear();
    overlay.cornerNodes.clear();
    overlay.centerNodes.clear();
    overlay.insertedNodes.clear();

    const polygonGraph = overlay.polygonGraph;
    mesh.edges.forEach((edge: any) => {
      const vertexA = mesh.vertices[edge.vertices[0]].point;
      const vertexB = mesh.vertices[edge.vertices[1]].point;
      polygonGraph.moveTo(vertexA.x, vertexA.y);
      polygonGraph.lineTo(vertexB.x, vertexB.y);
    });
    polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });

    const dualGraph = overlay.dualGraph;
    mesh.edges.forEach((edge: any) => {
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
    mesh.vertices.forEach((vertex: any) => {
      cornerNodes.circle(vertex.point.x, vertex.point.y, 1.8);
    });
    cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });

    const centerNodes = overlay.centerNodes;
    mesh.faces.forEach((face: any) => {
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
}
