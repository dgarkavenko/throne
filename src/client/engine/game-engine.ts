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

    this.renderTerrain();
    this.setupPhysics();
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
      this.terrainControls.riverBranchChance !== sanitized.riverBranchChance;

    this.terrainControls = sanitized;

    if (needsRegeneration) {
      this.renderTerrain();
      return;
    }
    if (this.layers.terrain) {
      updateProvinceBorders(this.layers.terrain, this.terrainControls);
      this.setGraphOverlayVisibility(this.terrainControls);
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

  private renderTerrain(): void {
    if (!this.layers.terrain) {
      return;
    }
    const config = { width: this.config.width, height: this.config.height };
    const seed = this.terrainControls.seed >>> 0;
    const random = createRng(seed);
    const intermediateRandom = createRng(this.terrainControls.intermediateSeed >>> 0);
    const riverSeed = (this.terrainControls.seed ^ 0x9e3779b9) >>> 0;
    const riverRandom = createRng(riverSeed);
    const base = terrainBasegen(config, this.terrainControls, random);
    const provinceGraph = basegenPolitical(base.mesh, this.terrainControls, random);
    const refined = terrainRefine(base.mesh, provinceGraph, this.terrainControls, intermediateRandom, riverRandom);

    this.terrainState = { base, provinceGraph, refined };
    renderTerrainLayer(config, this.terrainControls, this.layers.terrain, base, provinceGraph, refined);
    const overlay = this.ensureMeshOverlay(this.layers.terrain);
    this.renderMeshOverlay(base.mesh, refined.refinedGeometry.insertedPoints, overlay);
    this.setGraphOverlayVisibility(this.terrainControls);
    this.hasTerrain = true;
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
