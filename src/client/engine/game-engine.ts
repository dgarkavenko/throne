import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationDirtyFlags, TerrainGenerationState } from '../../terrain/types';
import type { TerrainRenderControls } from '../terrain/render-controls';
import type { TerrainRenderRefinementState } from '../terrain/refinement-cache';
import { MapSystem } from './map-system';
import {
  buildNavigationGraph,
  createPolylineAdvanceState,
  facePathToPoints,
  findFacePathAStar,
  type NavigationGraph,
  type PolylineAdvanceState,
} from './pathfinding';
import type { ActorCommandMessage, ActorSnapshot, PlayerState, TerrainSnapshot, WorldSnapshotMessage } from '../types';

type GameConfig = {
  width: number;
  height: number;
  colliderScale: number;
  uiOffset: { x: number; y: number };
  autoGenerateTerrain?: boolean;
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

type MovementTestConfig = {
  enabled: boolean;
  unitCount: number;
  timePerFaceSeconds: number;
  lowlandThreshold: number;
  impassableThreshold: number;
  elevationPower: number;
  elevationGainK: number;
  riverPenalty: number;
  showPaths: boolean;
  spacingTarget: number;
};

type MovementTestUnit = {
  actorId: string;
  ownerId: string;
  color: number;
  sprite: any;
  lastStateSeq: number;
  routeStartFace: number;
  routeTargetFace: number | null;
  routeStartedAtServerMs: number;
  segmentDurationsMs: number[];
  segmentPrefixMs: number[];
  correctionOffset: { startedAtClientMs: number; endsAtClientMs: number; offsetX: number; offsetY: number } | null;
  currentFace: number;
  targetFace: number | null;
  commandId: number;
  facePath: number[];
  movement: PolylineAdvanceState | null;
};

export class GameEngine {
  private app: any = null;
  private layers = {
    terrain: null as any,
    units: null as any,
    ui: null as any,
  };
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
  private contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  private localPlayerId: string | null = null;
  private selectedActorId: string | null = null;
  private hoveredActorId: string | null = null;
  private lastTerrainVersion = 0;
  private actorById = new Map<string, MovementTestUnit>();
  private playerColorById = new Map<string, string>();
  private actorMoveListeners = new Set<(actorId: string, targetFace: number) => void>();
  private movementTestConfig: MovementTestConfig = {
    enabled: false,
    unitCount: 8,
    timePerFaceSeconds: 180,
    lowlandThreshold: 10,
    impassableThreshold: 28,
    elevationPower: 0.8,
    elevationGainK: 1,
    riverPenalty: 0.8,
    showPaths: true,
    spacingTarget: 16,
  };
  private navigationGraph: NavigationGraph | null = null;
  private movementUnits: MovementTestUnit[] = [];
  private movementPathGraphics: any = null;
  private serverClockOffsetMs = 0;
  private hasServerClockOffset = false;
  private lastWorldSnapshotSeq = -1;
  private terrainRenderState: TerrainRenderRefinementState | null = null;
  private readonly mapSystem: MapSystem;
  private readonly autoGenerateTerrain: boolean;
  private hasTerrain = false;

  constructor(config: GameConfig) {
    this.config = config;
    this.mapSystem = new MapSystem({ width: config.width, height: config.height });
    this.autoGenerateTerrain = config.autoGenerateTerrain !== false;
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
    const unitsLayer = new window.PIXI.Container();
    const uiLayer = new window.PIXI.Container();
    uiLayer.x = this.config.uiOffset.x;
    uiLayer.y = this.config.uiOffset.y;
    appInstance.stage.addChild(terrainLayer);
    appInstance.stage.addChild(unitsLayer);
    appInstance.stage.addChild(uiLayer);
    this.layers.terrain = terrainLayer;
    this.layers.units = unitsLayer;
    this.layers.ui = uiLayer;

    if (this.autoGenerateTerrain) {
      this.regenerateTerrain();
    }
    this.setupProvinceInteractionEvents();
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    const result = this.mapSystem.setTerrainGenerationControls(nextControls);
    if (!this.hasTerrain) {
      this.regenerateTerrain();
      return;
    }
    if (result.changed) {
      this.regenerateTerrainPartial(result.dirty);
      return;
    }
    if (this.layers.terrain) {
      this.renderTerrainState(this.mapSystem.ensureGenerationState());
      this.renderProvinceInteractionOverlay();
    }
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    const result = this.mapSystem.setTerrainRenderControls(nextControls);
    if (!this.hasTerrain) {
      if (this.autoGenerateTerrain) {
        this.regenerateTerrain();
      }
      return;
    }
    if (result.changed && this.terrainState) {
      this.renderTerrainState(this.terrainState);
      this.renderProvinceInteractionOverlay();
    }
  }

  setMovementTestConfig(nextConfig: Partial<MovementTestConfig>): void {
    const current = this.movementTestConfig;
    const safeValue = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);
    const lowlandThreshold = this.clamp(
      Math.round(safeValue(nextConfig.lowlandThreshold ?? current.lowlandThreshold, current.lowlandThreshold)),
      1,
      31
    );
    const impassableThresholdInput = this.clamp(
      Math.round(
        safeValue(nextConfig.impassableThreshold ?? current.impassableThreshold, current.impassableThreshold)
      ),
      2,
      32
    );
    const impassableThreshold = this.clamp(Math.max(lowlandThreshold + 1, impassableThresholdInput), 2, 32);
    const sanitized: MovementTestConfig = {
      enabled: typeof nextConfig.enabled === 'boolean' ? nextConfig.enabled : current.enabled,
      unitCount: this.clamp(Math.round(safeValue(nextConfig.unitCount ?? current.unitCount, current.unitCount)), 0, 128),
      timePerFaceSeconds: this.clamp(
        Math.round(
          safeValue(nextConfig.timePerFaceSeconds ?? current.timePerFaceSeconds, current.timePerFaceSeconds)
        ),
        1,
        600
      ),
      lowlandThreshold,
      impassableThreshold,
      elevationPower: this.clamp(
        safeValue(nextConfig.elevationPower ?? current.elevationPower, current.elevationPower),
        0.5,
        2
      ),
      elevationGainK: this.clamp(
        safeValue(nextConfig.elevationGainK ?? current.elevationGainK, current.elevationGainK),
        0,
        4
      ),
      riverPenalty: this.clamp(safeValue(nextConfig.riverPenalty ?? current.riverPenalty, current.riverPenalty), 0, 8),
      showPaths: typeof nextConfig.showPaths === 'boolean' ? nextConfig.showPaths : current.showPaths,
      spacingTarget: this.clamp(
        Math.round(safeValue(nextConfig.spacingTarget ?? current.spacingTarget, current.spacingTarget)),
        16,
        128
      ),
    };

    const changed =
      sanitized.enabled !== current.enabled ||
      sanitized.unitCount !== current.unitCount ||
      sanitized.timePerFaceSeconds !== current.timePerFaceSeconds ||
      sanitized.lowlandThreshold !== current.lowlandThreshold ||
      sanitized.impassableThreshold !== current.impassableThreshold ||
      sanitized.elevationPower !== current.elevationPower ||
      sanitized.elevationGainK !== current.elevationGainK ||
      sanitized.riverPenalty !== current.riverPenalty ||
      sanitized.showPaths !== current.showPaths ||
      sanitized.spacingTarget !== current.spacingTarget;
    if (!changed) {
      return;
    }

    const unitPopulationChanged =
      sanitized.enabled !== current.enabled ||
      sanitized.unitCount !== current.unitCount;
    const routeCostChanged =
      sanitized.lowlandThreshold !== current.lowlandThreshold ||
      sanitized.impassableThreshold !== current.impassableThreshold ||
      sanitized.elevationPower !== current.elevationPower ||
      sanitized.elevationGainK !== current.elevationGainK ||
      sanitized.riverPenalty !== current.riverPenalty;
    this.movementTestConfig = sanitized;
    if (unitPopulationChanged) {
      this.rebuildMovementNavigationAndUnits();
      return;
    }
    if (routeCostChanged) {
      this.rebuildMovementNavigationGraph();
      this.replanMovementUnitsToCurrentTargets();
      this.renderMovementPathDebug();
      return;
    }
    this.renderMovementPathDebug();
  }

  start(onFrame?: (deltaMs: number, now: number) => void): void {
    if (!this.app) {
      return;
    }
    this.app.ticker.add((ticker: { deltaMS: number }) => {
      this.updateMovementTestUnits(ticker.deltaMS);
      if (onFrame) {
        onFrame(ticker.deltaMS, performance.now());
      }
    });
  }

  renderPlayers(players: PlayerState[]): void {
    if (!this.layers.ui || !window.PIXI) {
      return;
    }
    this.playerColorById.clear();
    const uiLayer = this.layers.ui;
    uiLayer.removeChildren();
    players.forEach((player, index) => {
      this.playerColorById.set(player.id, player.color || '#f5f5f5');
      const style = new window.PIXI.TextStyle({
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        fontSize: 28,
        fill: player.color || '#f5f5f5',
      });
      const row = new window.PIXI.Text((player.emoji || '\ud83e\udd34') + ':', style);
      row.x = 0;
      row.y = index * 36;
      uiLayer.addChild(row);
    });
    this.refreshAllActorVisuals();
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

  getTerrainVersion(): number {
    return this.lastTerrainVersion;
  }

  setLocalPlayerId(playerId: string | null): void {
    this.localPlayerId = playerId;
    if (this.selectedActorId && this.actorById.get(this.selectedActorId)?.ownerId !== this.localPlayerId) {
      this.selectedActorId = null;
    }
    this.refreshAllActorVisuals();
  }

  setSelectedActor(actorId: string | null): void {
    if (actorId && this.actorById.get(actorId)?.ownerId !== this.localPlayerId) {
      return;
    }
    if (this.selectedActorId === actorId) {
      return;
    }
    this.selectedActorId = actorId;
    this.refreshAllActorVisuals();
  }

  getSelectedActorId(): string | null {
    return this.selectedActorId;
  }

  onActorMoveCommand(listener: (actorId: string, targetFace: number) => void): () => void {
    this.actorMoveListeners.add(listener);
    return () => {
      this.actorMoveListeners.delete(listener);
    };
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return {
      controls: this.mapSystem.getGenerationControls(),
      movement: {
        timePerFaceSeconds: this.movementTestConfig.timePerFaceSeconds,
        lowlandThreshold: this.movementTestConfig.lowlandThreshold,
        impassableThreshold: this.movementTestConfig.impassableThreshold,
        elevationPower: this.movementTestConfig.elevationPower,
        elevationGainK: this.movementTestConfig.elevationGainK,
        riverPenalty: this.movementTestConfig.riverPenalty,
      },
      mapWidth: this.config.width,
      mapHeight: this.config.height,
    };
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.lastTerrainVersion = Math.max(0, Math.round(terrainVersion));
    this.lastWorldSnapshotSeq = -1;
    this.setTerrainGenerationControls(snapshot.controls);
    this.setMovementTestConfig({
      timePerFaceSeconds: snapshot.movement.timePerFaceSeconds,
      lowlandThreshold: snapshot.movement.lowlandThreshold,
      impassableThreshold: snapshot.movement.impassableThreshold,
      elevationPower: snapshot.movement.elevationPower,
      elevationGainK: snapshot.movement.elevationGainK,
      riverPenalty: snapshot.movement.riverPenalty,
    });
    this.replanMovementUnitsToCurrentTargets();
    this.renderMovementPathDebug();
  }

  applyActorCommand(command: ActorCommandMessage): void {
    if (!this.terrainState || !this.navigationGraph || command.terrainVersion !== this.lastTerrainVersion) {
      return;
    }
    const actor = this.ensureReplicatedActor(command.actorId, command.ownerId);
    if (command.commandId < actor.commandId) {
      return;
    }
    actor.commandId = command.commandId;
    actor.routeStartFace = command.startFace;
    actor.routeTargetFace = command.targetFace;
    actor.routeStartedAtServerMs = command.routeStartedAtServerMs;
    actor.currentFace = command.startFace;
    actor.targetFace = command.targetFace;
    actor.correctionOffset = null;
    this.assignPathFromFaceToTarget(actor, command.startFace, command.targetFace);
    const clientNow = Date.now();
    const estimatedServerNow = this.getEstimatedServerNow(clientNow);
    this.updateUnitPoseFromTimeline(actor, estimatedServerNow, clientNow);
    this.refreshActorVisual(actor);
    this.renderMovementPathDebug();
  }

  applyWorldSnapshot(snapshot: WorldSnapshotMessage): void {
    if (!this.navigationGraph || !this.terrainState || snapshot.terrainVersion !== this.lastTerrainVersion) {
      return;
    }
    if (snapshot.snapshotSeq <= this.lastWorldSnapshotSeq) {
      return;
    }
    this.lastWorldSnapshotSeq = snapshot.snapshotSeq;
    const clientReceiveMs = Date.now();
    this.updateServerClockOffset(snapshot.serverTime, clientReceiveMs);
    const estimatedServerNow = this.getEstimatedServerNow(clientReceiveMs);
    const liveActorIds = new Set<string>();
    for (let i = 0; i < snapshot.actors.length; i += 1) {
      const actorSnapshot = snapshot.actors[i];
      if (actorSnapshot.terrainVersion !== snapshot.terrainVersion) {
        continue;
      }
      liveActorIds.add(actorSnapshot.actorId);
      const actor = this.ensureReplicatedActor(actorSnapshot.actorId, actorSnapshot.ownerId);
      if (actorSnapshot.commandId < actor.commandId || actorSnapshot.stateSeq < actor.lastStateSeq) {
        continue;
      }
      this.syncActorFromSnapshot(actor, actorSnapshot, estimatedServerNow, clientReceiveMs);
    }
    const staleActorIds: string[] = [];
    this.actorById.forEach((_, actorId) => {
      if (!liveActorIds.has(actorId)) {
        staleActorIds.push(actorId);
      }
    });
    for (let i = 0; i < staleActorIds.length; i += 1) {
      this.removeReplicatedActor(staleActorIds[i]);
    }
    if (this.selectedActorId && !this.actorById.has(this.selectedActorId)) {
      this.selectedActorId = null;
    }
    this.renderMovementPathDebug();
  }

  onProvinceSelectionChange(listener: (provinceId: number | null) => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  private regenerateTerrainPartial(flags: TerrainGenerationDirtyFlags): void {
    if (!this.layers.terrain) {
      return;
    }
    const state = this.mapSystem.regeneratePartial(flags);
    this.terrainState = state;
    this.rebuildMovementNavigationAndUnits();
    this.renderTerrainState(state);
    this.rebuildProvinceInteractionModel();
    this.renderProvinceInteractionOverlay();
    this.hasTerrain = true;
  }

  private renderTerrainState(state: TerrainGenerationState): void {
    if (!this.layers.terrain) {
      return;
    }
    this.terrainRenderState = this.mapSystem.render(this.layers.terrain);
    const overlay = this.ensureMeshOverlay(this.layers.terrain);
    this.renderMeshOverlay(state.mesh.mesh, this.terrainRenderState?.refinedGeometry.insertedPoints ?? [], overlay);
    this.setGraphOverlayVisibility(this.mapSystem.getRenderControls());
  }

  private regenerateTerrain(): void {
    if (!this.layers.terrain) {
      return;
    }
    const state = this.mapSystem.regenerateAll();
    this.terrainState = state;
    this.rebuildMovementNavigationAndUnits();
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
    if (this.contextMenuHandler) {
      canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    }

    this.pointerMoveHandler = (event: PointerEvent) => {
      const position = this.getPointerWorldPosition(event);
      if (!position) {
        return;
      }
      const hoveredActorId = this.pickActorAt(position.x, position.y);
      if (this.hoveredActorId !== hoveredActorId) {
        this.hoveredActorId = hoveredActorId;
        this.refreshAllActorVisuals();
      }
      if (hoveredActorId) {
        this.setHoveredProvince(null);
        return;
      }
      const nextHover = this.pickProvinceAt(position.x, position.y);
      this.setHoveredProvince(nextHover);
    };
    this.pointerLeaveHandler = () => {
      this.hoveredActorId = null;
      this.refreshAllActorVisuals();
      this.setHoveredProvince(null);
    };
    this.pointerDownHandler = (event: PointerEvent) => {
      const position = this.getPointerWorldPosition(event);
      if (!position) {
        return;
      }
      if (event.button === 0) {
        const actorId = this.pickActorAt(position.x, position.y);
        if (actorId && this.actorById.get(actorId)?.ownerId === this.localPlayerId) {
          this.setSelectedActor(actorId);
          this.setSelectedProvince(null);
          return;
        }
        const nextSelection = this.pickProvinceAt(position.x, position.y);
        this.setSelectedProvince(nextSelection);
        return;
      }
      if (event.button === 2) {
        const selectedActorId = this.selectedActorId;
        const selectedActor = selectedActorId ? this.actorById.get(selectedActorId) : null;
        if (!selectedActorId || !selectedActor || selectedActor.ownerId !== this.localPlayerId) {
          return;
        }
        const targetFace = this.pickFaceAt(position.x, position.y);
        if (targetFace === null) {
          return;
        }
        this.actorMoveListeners.forEach((listener) => listener(selectedActorId, targetFace));
      }
    };
    this.contextMenuHandler = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener('pointermove', this.pointerMoveHandler);
    canvas.addEventListener('pointerleave', this.pointerLeaveHandler);
    canvas.addEventListener('pointerdown', this.pointerDownHandler);
    canvas.addEventListener('contextmenu', this.contextMenuHandler);
  }

  private rebuildProvinceInteractionModel(): void {
    if (!this.terrainState) {
      this.provinceInteractionModel = null;
      return;
    }
    const { mesh: meshState, provinces } = this.terrainState;
    const mesh = meshState.mesh;
    const faceCount = mesh.faces.length;
    const facePolygons: Vec2[][] = new Array(faceCount);
    const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
    const generationControls = this.mapSystem.getGenerationControls();
    const gridSize = Math.max(32, generationControls.spacing * 2);
    const gridColumns = Math.max(1, Math.ceil(this.config.width / gridSize));
    const gridRows = Math.max(1, Math.ceil(this.config.height / gridSize));
    const grid = new Map<number, number[]>();

    for (let i = 0; i < faceCount; i += 1) {
      const baseCell = meshState.baseCells[i];
      const cell = baseCell;
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

    const provinceCentroids: Array<Vec2 | null> = new Array(provinces.faces.length).fill(null);
    provinces.faces.forEach((province, index) => {
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

    const provinceBorderPaths: Vec2[][][] = new Array(provinces.faces.length);
    provinces.faces.forEach((province, index) => {
      const segments: Vec2[][] = [];
      province.outerEdges.forEach((edgeIndex) => {
        const outerEdge = provinces.outerEdges[edgeIndex];
        const edge = mesh.edges[outerEdge.edge];
        if (!edge) {
          return;
        }
        const a = mesh.vertices[edge.vertices[0]]?.point;
        const b = mesh.vertices[edge.vertices[1]]?.point;
        if (!a || !b) {
          return;
        }
        segments.push([a, b]);
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
      provinceByFace: provinces.provinceByFace,
      isLand: provinces.isLand,
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

    const borderWidth = this.mapSystem.getRenderControls().provinceBorderWidth;
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
      const neighbors = this.terrainState?.provinces.faces[this.selectedProvinceId]?.adjacentProvinces ?? [];
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

  pickFaceAt(worldX: number, worldY: number): number | null {
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
      return faceIndex;
    }
    return null;
  }

  pickActorAt(worldX: number, worldY: number): string | null {
    let bestId: string | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    this.actorById.forEach((actor, actorId) => {
      const dx = worldX - actor.sprite.x;
      const dy = worldY - actor.sprite.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= 100 && distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = actorId;
      }
    });
    return bestId;
  }

  private pickProvinceAt(worldX: number, worldY: number): number | null {
    const faceIndex = this.pickFaceAt(worldX, worldY);
    if (faceIndex === null) {
      return null;
    }
    const model = this.provinceInteractionModel;
    if (!model) {
      return null;
    }
    const provinceId = model.provinceByFace[faceIndex];
    return provinceId >= 0 ? provinceId : null;
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

  private rebuildMovementNavigationAndUnits(): void {
    this.rebuildMovementNavigationGraph();
    this.replanMovementUnitsToCurrentTargets();
    this.syncAllActorSpritePositionsToFaces();
    this.renderMovementPathDebug();
  }

  private rebuildMovementNavigationGraph(): void {
    if (!this.terrainState) {
      this.navigationGraph = null;
      return;
    }

    const { mesh, water, rivers } = this.terrainState;
    this.navigationGraph = buildNavigationGraph(
      mesh.mesh,
      water.isLand,
      rivers.riverEdgeMask,
      {
        lowlandThreshold: this.movementTestConfig.lowlandThreshold,
        impassableThreshold: this.movementTestConfig.impassableThreshold,
        elevationPower: this.movementTestConfig.elevationPower,
        elevationGainK: this.movementTestConfig.elevationGainK,
        riverPenalty: this.movementTestConfig.riverPenalty,
      }
    );
  }

  private clearMovementUnits(): void {
    this.actorById.clear();
    this.selectedActorId = null;
    this.hoveredActorId = null;
    this.movementUnits = [];
    if (!this.layers.units) {
      return;
    }
    const removed = this.layers.units.removeChildren();
    for (let i = 0; i < removed.length; i += 1) {
      const child = removed[i] as { destroy?: (options?: { children?: boolean }) => void };
      child?.destroy?.({ children: true });
    }
    this.movementPathGraphics = null;
  }

  private resetMovementUnits(): void {
    if (!this.layers.units || !window.PIXI || !this.navigationGraph) {
      return;
    }
    this.renderMovementPathDebug();
  }

  private getMovementUnitColor(index: number): number {
    const palette = [0xffce54, 0x48dbfb, 0xff6b6b, 0x1dd1a1, 0xf368e0, 0xfeca57, 0x54a0ff, 0x5f27cd];
    return palette[index % palette.length];
  }

  private createMovementUnitSprite(color: number): any {
    const graphic = new window.PIXI.Graphics();
    graphic.circle(0, 0, 5);
    graphic.fill({ color, alpha: 0.95 });
    graphic.stroke({ width: 2, color: 0x0b0e12, alpha: 0.9 });
    graphic.eventMode = 'none';
    graphic.tint = color;
    return graphic;
  }

  private ensureReplicatedActor(actorId: string, ownerId: string): MovementTestUnit {
    const existing = this.actorById.get(actorId);
    if (existing) {
      existing.ownerId = ownerId;
      existing.color = this.resolveActorColor(ownerId, existing.color);
      existing.sprite.tint = existing.color;
      this.refreshActorVisual(existing);
      return existing;
    }

    const fallbackColor = this.getMovementUnitColor(this.movementUnits.length);
    const color = this.resolveActorColor(ownerId, fallbackColor);
    const sprite = this.createMovementUnitSprite(color);
    const unit: MovementTestUnit = {
      actorId,
      ownerId,
      color,
      sprite,
      lastStateSeq: 0,
      routeStartFace: 0,
      routeTargetFace: null,
      routeStartedAtServerMs: 0,
      segmentDurationsMs: [],
      segmentPrefixMs: [0],
      correctionOffset: null,
      currentFace: 0,
      targetFace: null,
      commandId: 0,
      facePath: [],
      movement: null,
    };
    this.actorById.set(actorId, unit);
    this.movementUnits.push(unit);
    if (this.layers.units) {
      this.layers.units.addChild(sprite);
    }
    this.refreshActorVisual(unit);
    return unit;
  }

  private removeReplicatedActor(actorId: string): void {
    const unit = this.actorById.get(actorId);
    if (!unit) {
      return;
    }
    this.actorById.delete(actorId);
    const nextUnits: MovementTestUnit[] = [];
    for (let i = 0; i < this.movementUnits.length; i += 1) {
      const entry = this.movementUnits[i];
      if (entry.actorId !== actorId) {
        nextUnits.push(entry);
      }
    }
    this.movementUnits = nextUnits;
    if (unit.sprite?.removeFromParent) {
      unit.sprite.removeFromParent();
    }
    unit.sprite?.destroy?.();
  }

  private syncActorFromSnapshot(
    actor: MovementTestUnit,
    snapshot: ActorSnapshot,
    estimatedServerNow: number,
    clientReceiveMs: number
  ): void {
    actor.commandId = snapshot.commandId;
    actor.lastStateSeq = snapshot.stateSeq;
    actor.ownerId = snapshot.ownerId;
    actor.color = this.resolveActorColor(snapshot.ownerId, actor.color);
    actor.sprite.tint = actor.color;
    actor.currentFace = snapshot.currentFace;

    const currentFacePoint = this.getFacePoint(snapshot.currentFace);
    if (!snapshot.moving || snapshot.targetFace === null || snapshot.routeTargetFace === null) {
      actor.routeStartFace = snapshot.currentFace;
      actor.targetFace = null;
      actor.routeTargetFace = null;
      actor.facePath = [snapshot.currentFace];
      actor.segmentDurationsMs = [];
      actor.segmentPrefixMs = [0];
      actor.movement = null;
      actor.correctionOffset = null;
      if (currentFacePoint) {
        actor.sprite.x = currentFacePoint.x;
        actor.sprite.y = currentFacePoint.y;
      }
      this.refreshActorVisual(actor);
      return;
    }

    actor.routeStartFace = snapshot.routeStartFace;
    actor.routeTargetFace = snapshot.routeTargetFace;
    actor.routeStartedAtServerMs = snapshot.routeStartedAtServerMs;
    actor.targetFace = snapshot.targetFace;

    const routeReady = this.assignPathFromFaceToTarget(actor, snapshot.routeStartFace, snapshot.routeTargetFace);
    if (!routeReady || !actor.movement || actor.facePath.length < 2) {
      actor.targetFace = null;
      actor.routeTargetFace = null;
      actor.movement = null;
      actor.correctionOffset = null;
      if (currentFacePoint) {
        actor.sprite.x = currentFacePoint.x;
        actor.sprite.y = currentFacePoint.y;
      }
      this.refreshActorVisual(actor);
      return;
    }

    const predicted = this.evaluateUnitTimeline(actor, estimatedServerNow);
    if (!predicted) {
      this.refreshActorVisual(actor);
      return;
    }

    const segmentIndex = this.findSegmentIndexByFaces(actor.facePath, snapshot.segmentFromFace, snapshot.segmentToFace);
    const topologyMismatch = segmentIndex < 0;
    const authoritativeT = this.clamp(snapshot.segmentTQ16 / 65535, 0, 1);
    const fromPoint = topologyMismatch
      ? predicted.fromPoint
      : actor.movement.points[segmentIndex];
    const toPoint = topologyMismatch
      ? predicted.toPoint
      : actor.movement.points[segmentIndex + 1] ?? predicted.toPoint;
    const authoritativePos = this.computeLerp(fromPoint, toPoint, authoritativeT);
    const drift = Math.hypot(authoritativePos.x - predicted.position.x, authoritativePos.y - predicted.position.y);

    if (topologyMismatch || drift > 32) {
      const safeSegmentIndex = topologyMismatch ? predicted.segmentIndex : segmentIndex;
      const segmentDuration = actor.segmentDurationsMs[safeSegmentIndex] ?? 0;
      const elapsedToAuthoritativePoint =
        (actor.segmentPrefixMs[safeSegmentIndex] ?? 0) + segmentDuration * authoritativeT;
      actor.routeStartedAtServerMs = estimatedServerNow - elapsedToAuthoritativePoint;
      actor.correctionOffset = null;
    } else if (drift > 6) {
      actor.correctionOffset = {
        startedAtClientMs: clientReceiveMs,
        endsAtClientMs: clientReceiveMs + 150,
        offsetX: authoritativePos.x - predicted.position.x,
        offsetY: authoritativePos.y - predicted.position.y,
      };
    } else {
      actor.correctionOffset = null;
    }

    this.updateUnitPoseFromTimeline(actor, estimatedServerNow, clientReceiveMs);
    this.refreshActorVisual(actor);
  }

  private syncAllActorSpritePositionsToFaces(): void {
    if (!this.navigationGraph) {
      return;
    }
    const clientNow = Date.now();
    const estimatedServerNow = this.getEstimatedServerNow(clientNow);
    for (let i = 0; i < this.movementUnits.length; i += 1) {
      this.updateUnitPoseFromTimeline(this.movementUnits[i], estimatedServerNow, clientNow);
      this.refreshActorVisual(this.movementUnits[i]);
    }
  }

  private refreshAllActorVisuals(): void {
    for (let i = 0; i < this.movementUnits.length; i += 1) {
      this.refreshActorVisual(this.movementUnits[i]);
    }
  }

  private refreshActorVisual(actor: MovementTestUnit): void {
    if (!actor.sprite) {
      return;
    }
    const isSelected = this.selectedActorId === actor.actorId;
    const isHovered = this.hoveredActorId === actor.actorId;
    const isOwned = actor.ownerId === this.localPlayerId;
    const scale = isSelected ? 1.45 : isHovered ? 1.2 : 1;
    actor.sprite.scale?.set?.(scale, scale);
    actor.sprite.alpha = isOwned ? 0.97 : 0.88;
  }

  private resolveActorColor(ownerId: string, fallbackColor: number): number {
    const cssColor = this.playerColorById.get(ownerId);
    if (!cssColor) {
      return fallbackColor;
    }
    const normalized = cssColor.trim();
    const match6 = /^#([0-9a-f]{6})$/i.exec(normalized);
    if (match6) {
      return Number.parseInt(match6[1], 16);
    }
    const match3 = /^#([0-9a-f]{3})$/i.exec(normalized);
    if (match3) {
      const expanded = `${match3[1][0]}${match3[1][0]}${match3[1][1]}${match3[1][1]}${match3[1][2]}${match3[1][2]}`;
      return Number.parseInt(expanded, 16);
    }
    return fallbackColor;
  }

  private assignPathToTargetFace(unit: MovementTestUnit, targetFace: number, _fromCurrentPosition: boolean): boolean {
    const startFace = this.resolveUnitPathStartFace(unit);
    if (startFace === null) {
      return false;
    }
    return this.assignPathFromFaceToTarget(unit, startFace, targetFace);
  }

  private assignPathFromFaceToTarget(unit: MovementTestUnit, startFace: number, targetFace: number): boolean {
    if (!this.terrainState || !this.navigationGraph || !this.navigationGraph.nodes[startFace] || !this.navigationGraph.nodes[targetFace]) {
      return false;
    }

    if (startFace === targetFace) {
      unit.routeStartFace = startFace;
      unit.routeTargetFace = null;
      unit.currentFace = startFace;
      unit.targetFace = null;
      unit.facePath = [startFace];
      unit.segmentDurationsMs = [];
      unit.segmentPrefixMs = [0];
      unit.movement = createPolylineAdvanceState([{ ...this.navigationGraph.nodes[startFace].point }], 0);
      return true;
    }

    const result = findFacePathAStar(this.navigationGraph, startFace, targetFace);
    if (!Number.isFinite(result.totalCost) || result.facePath.length < 2) {
      return false;
    }

    const pathPoints = facePathToPoints(this.terrainState.mesh.mesh, result.facePath);
    const segmentDurationsMs = this.buildPathSegmentDurationsMs(result.facePath);
    if (pathPoints.length < 2 || segmentDurationsMs.length !== pathPoints.length - 1) {
      return false;
    }

    unit.currentFace = startFace;
    unit.routeStartFace = startFace;
    unit.routeTargetFace = targetFace;
    unit.targetFace = targetFace;
    unit.facePath = result.facePath;
    unit.segmentDurationsMs = segmentDurationsMs;
    unit.segmentPrefixMs = this.buildSegmentPrefixMs(segmentDurationsMs);
    unit.movement = createPolylineAdvanceState(pathPoints, 0);
    unit.movement.segmentIndex = 0;
    unit.movement.segmentT = 0;
    unit.movement.position = { ...pathPoints[0] };
    unit.movement.finished = false;
    return true;
  }

  private resolveUnitPathStartFace(unit: MovementTestUnit): number | null {
    if (!this.navigationGraph) {
      return null;
    }
    if (this.navigationGraph.nodes[unit.currentFace]) {
      return unit.currentFace;
    }
    if (unit.facePath.length > 0) {
      for (let i = unit.facePath.length - 1; i >= 0; i -= 1) {
        const candidate = unit.facePath[i];
        if (this.navigationGraph.nodes[candidate]) {
          return candidate;
        }
      }
    }
    return null;
  }

  private replanMovementUnitsToCurrentTargets(): void {
    if (!this.navigationGraph || !this.terrainState) {
      return;
    }
    for (let i = 0; i < this.movementUnits.length; i += 1) {
      const unit = this.movementUnits[i];
      const targetFace = unit.routeTargetFace ?? unit.targetFace;
      if (targetFace === null) {
        continue;
      }
      const replanned = this.assignPathFromFaceToTarget(unit, unit.currentFace, targetFace);
      if (!replanned) {
        unit.targetFace = null;
        unit.routeTargetFace = null;
        unit.facePath = [unit.currentFace];
        unit.segmentDurationsMs = [];
        unit.segmentPrefixMs = [0];
        unit.movement = null;
      } else {
        unit.routeStartedAtServerMs = this.getEstimatedServerNow(Date.now());
      }
    }
  }

  private updateMovementTestUnits(_deltaMs: number): void {
    if (!this.navigationGraph || this.movementUnits.length === 0) {
      this.renderMovementPathDebug();
      return;
    }
    const clientNow = Date.now();
    const estimatedServerNow = this.getEstimatedServerNow(clientNow);
    for (let i = 0; i < this.movementUnits.length; i += 1) {
      this.updateUnitPoseFromTimeline(this.movementUnits[i], estimatedServerNow, clientNow);
    }
    this.renderMovementPathDebug();
  }

  private updateUnitPoseFromTimeline(unit: MovementTestUnit, estimatedServerNow: number, clientNow: number): void {
    if (!unit.movement || unit.facePath.length < 2 || unit.segmentDurationsMs.length === 0 || unit.routeTargetFace === null) {
      const point = this.getFacePoint(unit.currentFace);
      if (point) {
        unit.sprite.x = point.x;
        unit.sprite.y = point.y;
      }
      return;
    }
    const state = this.evaluateUnitTimeline(unit, estimatedServerNow);
    if (!state) {
      return;
    }
    unit.movement.segmentIndex = state.segmentIndex;
    unit.movement.segmentT = state.segmentT;
    unit.movement.finished = state.finished;
    const corrected = this.applyUnitCorrection(unit, state.position, clientNow);
    unit.movement.position = corrected;
    unit.sprite.x = corrected.x;
    unit.sprite.y = corrected.y;
    if (state.finished) {
      const finalFace = unit.facePath[unit.facePath.length - 1];
      if (Number.isFinite(finalFace)) {
        unit.currentFace = finalFace;
      }
      unit.targetFace = null;
      unit.routeTargetFace = null;
    } else {
      const fromFace = unit.facePath[state.segmentIndex];
      const toFace = unit.facePath[state.segmentIndex + 1];
      unit.currentFace = state.segmentT >= 0.5 ? toFace : fromFace;
    }
  }

  private evaluateUnitTimeline(
    unit: MovementTestUnit,
    estimatedServerNow: number
  ): { position: Vec2; fromPoint: Vec2; toPoint: Vec2; segmentIndex: number; segmentT: number; finished: boolean } | null {
    if (!unit.movement || unit.movement.points.length < 2 || unit.segmentDurationsMs.length === 0) {
      return null;
    }
    const totalMs = unit.segmentPrefixMs[unit.segmentPrefixMs.length - 1] ?? 0;
    if (totalMs <= 0) {
      const lastPoint = unit.movement.points[unit.movement.points.length - 1];
      return {
        position: { ...lastPoint },
        fromPoint: { ...lastPoint },
        toPoint: { ...lastPoint },
        segmentIndex: Math.max(0, unit.movement.points.length - 2),
        segmentT: 1,
        finished: true,
      };
    }
    const elapsedMs = this.clamp(estimatedServerNow - unit.routeStartedAtServerMs, 0, totalMs);
    const segmentIndex = this.findSegmentIndexByElapsed(unit.segmentPrefixMs, elapsedMs);
    const segmentDurationMs = unit.segmentDurationsMs[segmentIndex] ?? 0;
    const segmentStartMs = unit.segmentPrefixMs[segmentIndex] ?? 0;
    const segmentT =
      segmentDurationMs <= 1e-6 ? 1 : this.clamp((elapsedMs - segmentStartMs) / segmentDurationMs, 0, 1);
    const fromPoint = unit.movement.points[segmentIndex];
    const toPoint = unit.movement.points[segmentIndex + 1] ?? fromPoint;
    return {
      position: this.computeLerp(fromPoint, toPoint, segmentT),
      fromPoint: { ...fromPoint },
      toPoint: { ...toPoint },
      segmentIndex,
      segmentT,
      finished: elapsedMs >= totalMs - 0.001,
    };
  }

  private applyUnitCorrection(unit: MovementTestUnit, basePosition: Vec2, clientNow: number): Vec2 {
    const correction = unit.correctionOffset;
    if (!correction) {
      return basePosition;
    }
    if (clientNow >= correction.endsAtClientMs) {
      unit.correctionOffset = null;
      return basePosition;
    }
    const durationMs = Math.max(1, correction.endsAtClientMs - correction.startedAtClientMs);
    const progress = this.clamp((clientNow - correction.startedAtClientMs) / durationMs, 0, 1);
    const remaining = 1 - progress;
    return {
      x: basePosition.x + correction.offsetX * remaining,
      y: basePosition.y + correction.offsetY * remaining,
    };
  }

  private buildPathSegmentDurationsMs(facePath: number[]): number[] {
    if (!this.navigationGraph || facePath.length < 2) {
      return [];
    }
    const durations: number[] = [];
    for (let i = 0; i < facePath.length - 1; i += 1) {
      const fromFaceId = facePath[i];
      const toFaceId = facePath[i + 1];
      const fromNode = this.navigationGraph.nodes[fromFaceId];
      if (!fromNode) {
        return [];
      }
      const neighbor = fromNode.neighbors.find((entry) => entry.neighborFaceId === toFaceId);
      if (!neighbor || !Number.isFinite(neighbor.stepCost) || neighbor.stepCost <= 0) {
        return [];
      }
      durations.push(this.movementTestConfig.timePerFaceSeconds * neighbor.stepCost * 1000);
    }
    return durations;
  }

  private buildSegmentPrefixMs(segmentDurationsMs: number[]): number[] {
    const prefix = new Array<number>(segmentDurationsMs.length + 1);
    prefix[0] = 0;
    for (let i = 0; i < segmentDurationsMs.length; i += 1) {
      prefix[i + 1] = prefix[i] + Math.max(0, segmentDurationsMs[i]);
    }
    return prefix;
  }

  private findSegmentIndexByElapsed(prefix: number[], elapsedMs: number): number {
    if (prefix.length <= 1) {
      return 0;
    }
    const clamped = this.clamp(elapsedMs, 0, prefix[prefix.length - 1]);
    let low = 0;
    let high = prefix.length - 2;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = prefix[mid];
      const end = prefix[mid + 1];
      if (clamped < start) {
        high = mid - 1;
        continue;
      }
      if (clamped > end) {
        low = mid + 1;
        continue;
      }
      return mid;
    }
    return Math.max(0, Math.min(prefix.length - 2, low));
  }

  private findSegmentIndexByFaces(facePath: number[], fromFace: number | null, toFace: number | null): number {
    if (!Number.isFinite(fromFace) || !Number.isFinite(toFace)) {
      return -1;
    }
    for (let i = 0; i < facePath.length - 1; i += 1) {
      if (facePath[i] === fromFace && facePath[i + 1] === toFace) {
        return i;
      }
    }
    return -1;
  }

  private getFacePoint(faceId: number): Vec2 | null {
    if (!this.navigationGraph) {
      return null;
    }
    const node = this.navigationGraph.nodes[faceId];
    if (!node) {
      return null;
    }
    return { x: node.point.x, y: node.point.y };
  }

  private computeLerp(a: Vec2, b: Vec2, t: number): Vec2 {
    const clampedT = this.clamp(t, 0, 1);
    return {
      x: a.x + (b.x - a.x) * clampedT,
      y: a.y + (b.y - a.y) * clampedT,
    };
  }

  private updateServerClockOffset(serverTimeMs: number, clientReceiveMs: number): void {
    if (!Number.isFinite(serverTimeMs) || !Number.isFinite(clientReceiveMs)) {
      return;
    }
    const observedOffset = serverTimeMs - clientReceiveMs;
    if (!this.hasServerClockOffset) {
      this.serverClockOffsetMs = observedOffset;
      this.hasServerClockOffset = true;
      return;
    }
    const alpha = 0.1;
    this.serverClockOffsetMs = this.serverClockOffsetMs * (1 - alpha) + observedOffset * alpha;
  }

  private getEstimatedServerNow(clientNow: number): number {
    if (!this.hasServerClockOffset) {
      return clientNow;
    }
    return clientNow + this.serverClockOffsetMs;
  }

  private ensureMovementPathGraphics(): any {
    if (!this.layers.units || !window.PIXI) {
      return null;
    }
    if (this.movementPathGraphics) {
      if (this.movementPathGraphics.parent !== this.layers.units) {
        this.layers.units.addChildAt(this.movementPathGraphics, 0);
      } else if (this.layers.units.children[0] !== this.movementPathGraphics) {
        this.layers.units.setChildIndex(this.movementPathGraphics, 0);
      }
      return this.movementPathGraphics;
    }
    this.movementPathGraphics = new window.PIXI.Graphics();
    this.layers.units.addChildAt(this.movementPathGraphics, 0);
    return this.movementPathGraphics;
  }

  private renderMovementPathDebug(): void {
    const graphics = this.ensureMovementPathGraphics();
    if (!graphics) {
      return;
    }
    graphics.clear();
    if (!this.movementTestConfig.showPaths) {
      return;
    }

    for (let i = 0; i < this.movementUnits.length; i += 1) {
      const unit = this.movementUnits[i];
      const movement = unit.movement;
      if (!movement || movement.points.length < 2) {
        continue;
      }
      const startX = unit.sprite?.x ?? movement.position.x;
      const startY = unit.sprite?.y ?? movement.position.y;
      graphics.moveTo(startX, startY);

      const firstPointIndex = Math.min(movement.points.length - 1, Math.max(1, movement.segmentIndex + 1));
      for (let p = firstPointIndex; p < movement.points.length; p += 1) {
        const point = movement.points[p];
        graphics.lineTo(point.x, point.y);
      }
      graphics.stroke({ width: 1.8, color: unit.color, alpha: 0.7 });

      const targetPoint = movement.points[movement.points.length - 1];
      const markerSize = 5;
      graphics.moveTo(targetPoint.x - markerSize, targetPoint.y - markerSize);
      graphics.lineTo(targetPoint.x + markerSize, targetPoint.y + markerSize);
      graphics.moveTo(targetPoint.x - markerSize, targetPoint.y + markerSize);
      graphics.lineTo(targetPoint.x + markerSize, targetPoint.y - markerSize);
      graphics.stroke({ width: 1.8, color: unit.color, alpha: 0.95 });
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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

  private setGraphOverlayVisibility(controls: TerrainRenderControls): void {
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
