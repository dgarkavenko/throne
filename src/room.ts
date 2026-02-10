import {
  applyMountains,
  buildRiverTraces,
  createStepRng,
  generateMesh,
  generateWater,
  STEP_SEEDS,
  type TerrainControls,
} from './client/engine/terrain';
import { buildNavigationGraph, findFacePathAStar, type NavigationGraph } from './client/engine/pathfinding';
import type {
  ActorSnapshot,
  ActorMoveClientMessage,
  ClientMessage,
  TerrainControlValue,
  TerrainSnapshot,
  TerrainPublishClientMessage,
} from './client/types';

type PlayerState = {
  id: string;
  emoji: string;
  typing: string;
  color: string;
};

type RoomHistoryEntry = {
  text: string;
  color: string;
  emoji: string;
};

type ServerActorState = {
  actorId: string;
  ownerId: string;
  currentFace: number;
  targetFace: number | null;
  routeStartFace: number;
  routeTargetFace: number | null;
  routeStartedAtServerMs: number;
  commandId: number;
  stateSeq: number;
  moving: boolean;
  path: number[];
  segmentDurationsMs: number[];
  segmentIndex: number;
  segmentStartedAtServerMs: number;
  pendingCommandId: number | null;
  pendingTargetFace: number | null;
};

type TerrainRuntimeState = {
  terrainVersion: number;
  snapshot: TerrainSnapshot;
  navigationGraph: NavigationGraph;
};

const SNAPSHOT_INTERVAL_MS = 500;
const MAX_HISTORY = 100;
const DEFAULT_MAP_WIDTH = 1560;
const DEFAULT_MAP_HEIGHT = 844;

const DEFAULT_TERRAIN_CONTROLS: TerrainControls = {
  spacing: 16,
  showPolygonGraph: false,
  showDualGraph: false,
  showCornerNodes: false,
  showCenterNodes: false,
  showInsertedPoints: false,
  provinceCount: 8,
  provinceBorderWidth: 6.5,
  provinceSizeVariance: 0.4,
  provincePassageElevation: 6,
  provinceRiverPenalty: 0.6,
  provinceSmallIslandMultiplier: 0.35,
  provinceArchipelagoMultiplier: 0.2,
  provinceIslandSingleMultiplier: 1.6,
  provinceArchipelagoRadiusMultiplier: 3,
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeTerrainControls(controlsRaw: Record<string, TerrainControlValue> | null | undefined): TerrainControls {
  const controls = controlsRaw ?? {};
  return {
    spacing: clamp(Math.round(readNumber(controls.spacing, DEFAULT_TERRAIN_CONTROLS.spacing)), 16, 128),
    showPolygonGraph: readBool(controls.showPolygonGraph, DEFAULT_TERRAIN_CONTROLS.showPolygonGraph),
    showDualGraph: readBool(controls.showDualGraph, DEFAULT_TERRAIN_CONTROLS.showDualGraph),
    showCornerNodes: readBool(controls.showCornerNodes, DEFAULT_TERRAIN_CONTROLS.showCornerNodes),
    showCenterNodes: readBool(controls.showCenterNodes, DEFAULT_TERRAIN_CONTROLS.showCenterNodes),
    showInsertedPoints: readBool(controls.showInsertedPoints, DEFAULT_TERRAIN_CONTROLS.showInsertedPoints),
    provinceCount: clamp(Math.round(readNumber(controls.provinceCount, DEFAULT_TERRAIN_CONTROLS.provinceCount)), 1, 32),
    provinceBorderWidth: clamp(readNumber(controls.provinceBorderWidth, DEFAULT_TERRAIN_CONTROLS.provinceBorderWidth), 1, 24),
    provinceSizeVariance: clamp(readNumber(controls.provinceSizeVariance, DEFAULT_TERRAIN_CONTROLS.provinceSizeVariance), 0, 0.75),
    provincePassageElevation: clamp(
      Math.round(readNumber(controls.provincePassageElevation, DEFAULT_TERRAIN_CONTROLS.provincePassageElevation)),
      0,
      32
    ),
    provinceRiverPenalty: clamp(readNumber(controls.provinceRiverPenalty, DEFAULT_TERRAIN_CONTROLS.provinceRiverPenalty), 0, 2),
    provinceSmallIslandMultiplier: clamp(
      readNumber(controls.provinceSmallIslandMultiplier, DEFAULT_TERRAIN_CONTROLS.provinceSmallIslandMultiplier),
      0,
      1
    ),
    provinceArchipelagoMultiplier: clamp(
      readNumber(controls.provinceArchipelagoMultiplier, DEFAULT_TERRAIN_CONTROLS.provinceArchipelagoMultiplier),
      0,
      1
    ),
    provinceIslandSingleMultiplier: clamp(
      readNumber(controls.provinceIslandSingleMultiplier, DEFAULT_TERRAIN_CONTROLS.provinceIslandSingleMultiplier),
      1,
      3
    ),
    provinceArchipelagoRadiusMultiplier: clamp(
      readNumber(controls.provinceArchipelagoRadiusMultiplier, DEFAULT_TERRAIN_CONTROLS.provinceArchipelagoRadiusMultiplier),
      1,
      6
    ),
    showLandBorders: readBool(controls.showLandBorders, DEFAULT_TERRAIN_CONTROLS.showLandBorders),
    showShoreBorders: readBool(controls.showShoreBorders, DEFAULT_TERRAIN_CONTROLS.showShoreBorders),
    landRelief: clamp(readNumber(controls.landRelief, DEFAULT_TERRAIN_CONTROLS.landRelief), 0, 1),
    ridgeStrength: clamp(readNumber(controls.ridgeStrength, DEFAULT_TERRAIN_CONTROLS.ridgeStrength), 0, 1),
    ridgeCount: clamp(Math.round(readNumber(controls.ridgeCount, DEFAULT_TERRAIN_CONTROLS.ridgeCount)), 1, 10),
    plateauStrength: clamp(readNumber(controls.plateauStrength, DEFAULT_TERRAIN_CONTROLS.plateauStrength), 0, 1),
    ridgeDistribution: clamp(readNumber(controls.ridgeDistribution, DEFAULT_TERRAIN_CONTROLS.ridgeDistribution), 0, 1),
    ridgeSeparation: clamp(readNumber(controls.ridgeSeparation, DEFAULT_TERRAIN_CONTROLS.ridgeSeparation), 0, 1),
    ridgeContinuity: clamp(readNumber(controls.ridgeContinuity, DEFAULT_TERRAIN_CONTROLS.ridgeContinuity), 0, 1),
    ridgeContinuityThreshold: clamp(
      readNumber(controls.ridgeContinuityThreshold, DEFAULT_TERRAIN_CONTROLS.ridgeContinuityThreshold),
      0,
      1
    ),
    oceanPeakClamp: clamp(readNumber(controls.oceanPeakClamp, DEFAULT_TERRAIN_CONTROLS.oceanPeakClamp), 0, 1),
    ridgeOceanClamp: clamp(readNumber(controls.ridgeOceanClamp, DEFAULT_TERRAIN_CONTROLS.ridgeOceanClamp), 0, 1),
    ridgeWidth: clamp(readNumber(controls.ridgeWidth, DEFAULT_TERRAIN_CONTROLS.ridgeWidth), 0, 1),
    seed: clamp(Math.floor(readNumber(controls.seed, DEFAULT_TERRAIN_CONTROLS.seed)), 0, 0xffffffff),
    intermediateSeed: clamp(
      Math.floor(readNumber(controls.intermediateSeed, DEFAULT_TERRAIN_CONTROLS.intermediateSeed)),
      0,
      0xffffffff
    ),
    intermediateMaxIterations: clamp(
      Math.round(readNumber(controls.intermediateMaxIterations, DEFAULT_TERRAIN_CONTROLS.intermediateMaxIterations)),
      0,
      12
    ),
    intermediateThreshold: clamp(
      Math.round(readNumber(controls.intermediateThreshold, DEFAULT_TERRAIN_CONTROLS.intermediateThreshold)),
      2,
      20
    ),
    intermediateRelMagnitude: clamp(
      readNumber(controls.intermediateRelMagnitude, DEFAULT_TERRAIN_CONTROLS.intermediateRelMagnitude),
      0,
      2
    ),
    intermediateAbsMagnitude: clamp(
      readNumber(controls.intermediateAbsMagnitude, DEFAULT_TERRAIN_CONTROLS.intermediateAbsMagnitude),
      0,
      10
    ),
    waterLevel: clamp(Math.round(readNumber(controls.waterLevel, DEFAULT_TERRAIN_CONTROLS.waterLevel)), -40, 40),
    waterRoughness: clamp(
      Math.round(readNumber(controls.waterRoughness, DEFAULT_TERRAIN_CONTROLS.waterRoughness)),
      0,
      100
    ),
    waterNoiseScale: clamp(
      Math.round(readNumber(controls.waterNoiseScale, DEFAULT_TERRAIN_CONTROLS.waterNoiseScale)),
      2,
      60
    ),
    waterNoiseStrength: clamp(readNumber(controls.waterNoiseStrength, DEFAULT_TERRAIN_CONTROLS.waterNoiseStrength), 0, 1),
    waterNoiseOctaves: clamp(
      Math.round(readNumber(controls.waterNoiseOctaves, DEFAULT_TERRAIN_CONTROLS.waterNoiseOctaves)),
      1,
      6
    ),
    waterWarpScale: clamp(
      Math.round(readNumber(controls.waterWarpScale, DEFAULT_TERRAIN_CONTROLS.waterWarpScale)),
      2,
      40
    ),
    waterWarpStrength: clamp(readNumber(controls.waterWarpStrength, DEFAULT_TERRAIN_CONTROLS.waterWarpStrength), 0, 0.8),
    riverDensity: clamp(readNumber(controls.riverDensity, DEFAULT_TERRAIN_CONTROLS.riverDensity), 0, 2),
    riverBranchChance: clamp(readNumber(controls.riverBranchChance, DEFAULT_TERRAIN_CONTROLS.riverBranchChance), 0, 1),
    riverClimbChance: clamp(readNumber(controls.riverClimbChance, DEFAULT_TERRAIN_CONTROLS.riverClimbChance), 0, 1),
  };
}

function normalizeMovementConfig(movementRaw: TerrainSnapshot['movement'] | null | undefined): TerrainSnapshot['movement'] {
  const movement = movementRaw ?? {
    timePerFaceSeconds: 180,
    lowlandThreshold: 10,
    impassableThreshold: 28,
    elevationPower: 0.8,
    elevationGainK: 1,
    riverPenalty: 0.8,
  };
  const lowlandThreshold = clamp(Math.round(readNumber(movement.lowlandThreshold, 10)), 1, 31);
  const impassableThresholdInput = clamp(Math.round(readNumber(movement.impassableThreshold, 28)), 2, 32);
  const impassableThreshold = clamp(Math.max(lowlandThreshold + 1, impassableThresholdInput), 2, 32);
  return {
    timePerFaceSeconds: clamp(Math.round(readNumber(movement.timePerFaceSeconds, 180)), 1, 600),
    lowlandThreshold,
    impassableThreshold,
    elevationPower: clamp(readNumber(movement.elevationPower, 0.8), 0.5, 2),
    elevationGainK: clamp(readNumber(movement.elevationGainK, 1), 0, 4),
    riverPenalty: clamp(readNumber(movement.riverPenalty, 0.8), 0, 8),
  };
}

function normalizeTerrainSnapshot(snapshotRaw: TerrainSnapshot): TerrainSnapshot {
  const controls = normalizeTerrainControls(snapshotRaw.controls);
  const movement = normalizeMovementConfig(snapshotRaw.movement);
  const mapWidth = clamp(Math.round(readNumber(snapshotRaw.mapWidth, DEFAULT_MAP_WIDTH)), 256, 4096);
  const mapHeight = clamp(Math.round(readNumber(snapshotRaw.mapHeight, DEFAULT_MAP_HEIGHT)), 256, 4096);
  return {
    controls,
    movement,
    mapWidth,
    mapHeight,
  };
}

function fnv1aHash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private sessionStart: number | null = null;
  private history: RoomHistoryEntry[] = [];
  private terrain: TerrainRuntimeState | null = null;
  private actorsByPlayerId = new Map<string, ServerActorState>();
  private lastSnapshotAt = 0;
  private snapshotSeq = 0;

  private readonly emojis = [
    '\ud83e\udd34',
    '\ud83d\udc78',
    '\ud83e\udec5',
    '\ud83e\uddd9',
    '\ud83e\uddd9\u200d\u2640\ufe0f',
    '\ud83e\uddd9\u200d\u2642\ufe0f',
    '\ud83e\udddd',
    '\ud83e\udddd\u200d\u2640\ufe0f',
    '\ud83e\udddd\u200d\u2642\ufe0f',
    '\ud83e\udd3a',
    '\ud83d\udc68\u200d\ud83c\udf3e',
    '\ud83d\udc69\u200d\ud83c\udf3e',
  ];

  private readonly colors = [
    '#f6c1c7',
    '#f7d6b2',
    '#f8f1b4',
    '#c7f0d9',
    '#c4d7f7',
    '#d9c4f7',
    '#f7c4e3',
    '#c7f3f6',
    '#f6c7a6',
    '#d7f6b4',
    '#c9f6d7',
    '#f3c9f6',
  ];

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown
  ) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const changedActorIds = this.advanceAllActors(now);
    const snapshotDue = now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
    if (changedActorIds.size > 0 || snapshotDue) {
      this.broadcastWorldSnapshot();
    }
    await this.scheduleNextAlarm(now);
  }

  private handleSession(socket: WebSocket): void {
    socket.accept();

    const player: PlayerState = {
      id: crypto.randomUUID(),
      emoji: this.pickEmoji(),
      typing: '',
      color: this.pickColor(),
    };

    if (this.connections.size === 0) {
      this.hostId = player.id;
      this.sessionStart = Date.now();
    }

    this.connections.set(socket, player);
    const actorCountBefore = this.actorsByPlayerId.size;
    this.ensureActorForPlayer(player.id);

    this.sendJson(socket, {
      type: 'welcome',
      id: player.id,
    });

    this.broadcastState();
    if (this.terrain && this.actorsByPlayerId.size !== actorCountBefore) {
      this.broadcastWorldSnapshot();
    }

    socket.addEventListener('message', (event) => {
      const message = this.parseMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === 'join') {
        this.broadcastState();
        this.sendHistory(socket);
        if (this.terrain) {
          this.sendTerrainSnapshot(socket);
          this.sendWorldSnapshot(socket);
        }
        return;
      }

      if (message.type === 'typing') {
        const entry = this.connections.get(socket);
        if (entry && entry.typing !== message.text) {
          entry.typing = message.text;
          this.connections.set(socket, entry);
          this.broadcastState();
        }
        return;
      }

      if (message.type === 'launch') {
        const entry = this.connections.get(socket);
        const text = message.text.trim();
        if (!entry || !text) {
          return;
        }
        this.broadcastLaunch(text, entry);
        return;
      }

      if (message.type === 'terrain_publish') {
        this.handleTerrainPublish(socket, player, message);
        return;
      }

      if (message.type === 'actor_move') {
        this.handleActorMove(socket, player, message);
      }
    });

    const cleanup = () => {
      this.connections.delete(socket);
      this.actorsByPlayerId.delete(player.id);

      if (this.hostId === player.id) {
        const nextHost = this.connections.values().next().value as PlayerState | undefined;
        this.hostId = nextHost?.id ?? null;
      }

      if (this.connections.size === 0) {
        this.hostId = null;
        this.sessionStart = null;
      }

      this.broadcastState();
      this.broadcastWorldSnapshot();
      void this.scheduleNextAlarm();
    };

    socket.addEventListener('close', cleanup);
    socket.addEventListener('error', cleanup);
  }

  private handleTerrainPublish(socket: WebSocket, player: PlayerState, message: TerrainPublishClientMessage): void {
    if (!this.hostId || player.id !== this.hostId) {
      this.sendActorReject(socket, player.id, 0, 'terrain_publish_forbidden', this.terrain?.terrainVersion ?? 0);
      return;
    }

    let runtime: TerrainRuntimeState;
    try {
      const normalizedSnapshot = normalizeTerrainSnapshot(message.terrain);
      runtime = this.buildTerrainRuntime(normalizedSnapshot);
    } catch {
      this.sendActorReject(socket, player.id, 0, 'terrain_publish_invalid', this.terrain?.terrainVersion ?? 0);
      return;
    }

    this.terrain = runtime;
    this.reseedActorsForTerrain();

    this.broadcastJson({
      type: 'terrain_snapshot',
      terrainVersion: runtime.terrainVersion,
      terrain: runtime.snapshot,
      publishedBy: player.id,
      serverTime: Date.now(),
    });
    this.broadcastWorldSnapshot();
    void this.scheduleNextAlarm();
  }

  private handleActorMove(socket: WebSocket, player: PlayerState, message: ActorMoveClientMessage): void {
    if (!this.terrain) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'terrain_not_ready', 0);
      return;
    }

    const actor = this.actorsByPlayerId.get(player.id);
    if (!actor || actor.actorId !== message.actorId || actor.ownerId !== player.id) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'actor_not_owned', this.terrain.terrainVersion);
      return;
    }

    if (message.terrainVersion !== this.terrain.terrainVersion) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'terrain_version_mismatch', this.terrain.terrainVersion);
      return;
    }

    const maxKnownCommandId = Math.max(actor.commandId, actor.pendingCommandId ?? 0);
    if (message.commandId <= maxKnownCommandId) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'stale_command_id', this.terrain.terrainVersion);
      return;
    }

    const targetNode = this.terrain.navigationGraph.nodes[message.targetFace];
    if (!targetNode) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'target_unreachable', this.terrain.terrainVersion);
      return;
    }

    const now = Date.now();
    this.advanceActor(actor, now);
    if (actor.moving) {
      const nextFace = actor.path[actor.segmentIndex + 1];
      if (!Number.isFinite(nextFace)) {
        this.sendActorReject(socket, message.actorId, message.commandId, 'no_path', this.terrain.terrainVersion);
        return;
      }

      const validation = findFacePathAStar(this.terrain.navigationGraph, nextFace, message.targetFace);
      if (validation.facePath.length < 1 || !Number.isFinite(validation.totalCost)) {
        this.sendActorReject(socket, message.actorId, message.commandId, 'no_path', this.terrain.terrainVersion);
        return;
      }

      actor.pendingCommandId = message.commandId;
      actor.pendingTargetFace = message.targetFace;
      void this.scheduleNextAlarm(now);
      return;
    }

    const started = this.startActorRoute(actor, message.commandId, message.targetFace, now);
    if (!started) {
      this.sendActorReject(socket, message.actorId, message.commandId, 'no_path', this.terrain.terrainVersion);
      return;
    }

    this.broadcastWorldSnapshot();
    void this.scheduleNextAlarm(now);
  }

  private startActorRoute(
    actor: ServerActorState,
    commandId: number,
    targetFace: number,
    startedAtServerMs: number
  ): boolean {
    if (!this.terrain) {
      return false;
    }

    const startFace = actor.currentFace;
    actor.pendingCommandId = null;
    actor.pendingTargetFace = null;

    if (startFace === targetFace) {
      actor.commandId = commandId;
      actor.targetFace = null;
      actor.routeStartFace = startFace;
      actor.routeTargetFace = null;
      actor.routeStartedAtServerMs = startedAtServerMs;
      actor.path = [startFace];
      actor.segmentDurationsMs = [];
      actor.segmentIndex = 0;
      actor.segmentStartedAtServerMs = startedAtServerMs;
      actor.moving = false;
      actor.stateSeq += 1;

      this.broadcastJson({
        type: 'actor_command',
        actorId: actor.actorId,
        ownerId: actor.ownerId,
        commandId: actor.commandId,
        startFace,
        targetFace,
        startedAt: startedAtServerMs,
        routeStartedAtServerMs: startedAtServerMs,
        terrainVersion: this.terrain.terrainVersion,
      });
      return true;
    }

    const result = findFacePathAStar(this.terrain.navigationGraph, startFace, targetFace);
    if (result.facePath.length < 2 || !Number.isFinite(result.totalCost)) {
      return false;
    }

    const segmentDurationsMs = this.buildSegmentDurationsMs(result.facePath, this.terrain.snapshot.movement.timePerFaceSeconds);
    if (!segmentDurationsMs || segmentDurationsMs.length !== result.facePath.length - 1) {
      return false;
    }

    actor.commandId = commandId;
    actor.targetFace = targetFace;
    actor.routeStartFace = startFace;
    actor.routeTargetFace = targetFace;
    actor.routeStartedAtServerMs = startedAtServerMs;
    actor.stateSeq += 1;
    actor.path = result.facePath;
    actor.segmentDurationsMs = segmentDurationsMs;
    actor.segmentIndex = 0;
    actor.segmentStartedAtServerMs = startedAtServerMs;
    actor.moving = true;

    this.broadcastJson({
      type: 'actor_command',
      actorId: actor.actorId,
      ownerId: actor.ownerId,
      commandId: actor.commandId,
      startFace,
      targetFace,
      startedAt: startedAtServerMs,
      routeStartedAtServerMs: startedAtServerMs,
      terrainVersion: this.terrain.terrainVersion,
    });
    return true;
  }

  private buildTerrainRuntime(snapshot: TerrainSnapshot): TerrainRuntimeState {
    const terrainVersion = (this.terrain?.terrainVersion ?? 0) + 1;
    const controls = normalizeTerrainControls(snapshot.controls);
    const normalizedSnapshot: TerrainSnapshot = {
      controls,
      movement: normalizeMovementConfig(snapshot.movement),
      mapWidth: snapshot.mapWidth,
      mapHeight: snapshot.mapHeight,
    };

    const config = { width: normalizedSnapshot.mapWidth, height: normalizedSnapshot.mapHeight };
    const seed = controls.seed >>> 0;
    const meshRandom = createStepRng(seed, STEP_SEEDS.mesh);
    const waterRandom = createStepRng(seed, STEP_SEEDS.water);
    const mountainRandom = createStepRng(seed, STEP_SEEDS.mountain);
    const riverRandom = createStepRng(seed, STEP_SEEDS.river);

    const mesh = generateMesh(config, controls, meshRandom);
    const water = generateWater(config, mesh.mesh, mesh.baseCells, controls, waterRandom);
    applyMountains(mesh.mesh, water, controls, mountainRandom);
    const traces = buildRiverTraces(mesh.mesh, controls, riverRandom, water.isLand, water.oceanWater);

    const navigationGraph = buildNavigationGraph(mesh.mesh, water.isLand, traces.riverEdgeMask, {
      lowlandThreshold: normalizedSnapshot.movement.lowlandThreshold,
      impassableThreshold: normalizedSnapshot.movement.impassableThreshold,
      elevationPower: normalizedSnapshot.movement.elevationPower,
      elevationGainK: normalizedSnapshot.movement.elevationGainK,
      riverPenalty: normalizedSnapshot.movement.riverPenalty,
    });

    return {
      terrainVersion,
      snapshot: normalizedSnapshot,
      navigationGraph,
    };
  }

  private ensureActorForPlayer(playerId: string): void {
    if (!this.terrain || this.actorsByPlayerId.has(playerId)) {
      return;
    }
    const spawnFace = this.pickSpawnFace(playerId);
    if (spawnFace === null) {
      return;
    }
    this.actorsByPlayerId.set(playerId, {
      actorId: playerId,
      ownerId: playerId,
      currentFace: spawnFace,
      targetFace: null,
      routeStartFace: spawnFace,
      routeTargetFace: null,
      routeStartedAtServerMs: 0,
      commandId: 0,
      stateSeq: 0,
      moving: false,
      path: [spawnFace],
      segmentDurationsMs: [],
      segmentIndex: 0,
      segmentStartedAtServerMs: 0,
      pendingCommandId: null,
      pendingTargetFace: null,
    });
  }

  private reseedActorsForTerrain(): void {
    if (!this.terrain) {
      this.actorsByPlayerId.clear();
      return;
    }
    const nextActors = new Map<string, ServerActorState>();
    const playerIds = Array.from(this.connections.values())
      .map((player) => player.id)
      .sort((a, b) => a.localeCompare(b));

    for (let i = 0; i < playerIds.length; i += 1) {
      const playerId = playerIds[i];
      const spawnFace = this.pickSpawnFace(playerId);
      if (spawnFace === null) {
        continue;
      }
      nextActors.set(playerId, {
        actorId: playerId,
        ownerId: playerId,
        currentFace: spawnFace,
        targetFace: null,
        routeStartFace: spawnFace,
        routeTargetFace: null,
        routeStartedAtServerMs: 0,
        commandId: 0,
        stateSeq: 0,
        moving: false,
        path: [spawnFace],
        segmentDurationsMs: [],
        segmentIndex: 0,
        segmentStartedAtServerMs: 0,
        pendingCommandId: null,
        pendingTargetFace: null,
      });
    }

    this.actorsByPlayerId = nextActors;
  }

  private pickSpawnFace(playerId: string): number | null {
    if (!this.terrain) {
      return null;
    }
    const faceIds = this.terrain.navigationGraph.landFaceIds;
    if (faceIds.length === 0) {
      return null;
    }
    const hash = fnv1aHash32(`${this.terrain.terrainVersion}:${playerId}`);
    return faceIds[hash % faceIds.length] ?? null;
  }

  private buildSegmentDurationsMs(facePath: number[], timePerFaceSeconds: number): number[] | null {
    if (!this.terrain || facePath.length < 2) {
      return [];
    }
    const durationsMs: number[] = [];
    for (let i = 0; i < facePath.length - 1; i += 1) {
      const fromFace = facePath[i];
      const toFace = facePath[i + 1];
      const node = this.terrain.navigationGraph.nodes[fromFace];
      if (!node) {
        return null;
      }
      const edge = node.neighbors.find((neighbor) => neighbor.neighborFaceId === toFace);
      if (!edge || !Number.isFinite(edge.stepCost) || edge.stepCost <= 0) {
        return null;
      }
      durationsMs.push(timePerFaceSeconds * edge.stepCost * 1000);
    }
    return durationsMs;
  }

  private advanceAllActors(now: number): Set<string> {
    const changed = new Set<string>();
    for (const actor of this.actorsByPlayerId.values()) {
      if (this.advanceActor(actor, now)) {
        changed.add(actor.actorId);
      }
    }
    return changed;
  }

  private advanceActor(actor: ServerActorState, now: number): boolean {
    if (!actor.moving || actor.path.length < 2) {
      return false;
    }

    let changed = false;

    while (actor.moving) {
      const segmentDuration = actor.segmentDurationsMs[actor.segmentIndex] ?? 0;
      if (segmentDuration <= 0) {
        this.finishActorMovement(actor, now);
        changed = true;
        break;
      }
      const segmentEndsAt = actor.segmentStartedAtServerMs + segmentDuration;
      if (segmentEndsAt > now) {
        break;
      }

      const nextFace = actor.path[actor.segmentIndex + 1];
      if (!Number.isFinite(nextFace)) {
        this.finishActorMovement(actor, now);
        changed = true;
        break;
      }

      actor.currentFace = nextFace;
      actor.segmentIndex += 1;
      actor.segmentStartedAtServerMs = segmentEndsAt;
      actor.stateSeq += 1;
      changed = true;

      if (actor.pendingCommandId !== null && actor.pendingTargetFace !== null) {
        const pendingCommandId = actor.pendingCommandId;
        const pendingTargetFace = actor.pendingTargetFace;
        const startedPendingRoute = this.startActorRoute(actor, pendingCommandId, pendingTargetFace, segmentEndsAt);
        if (!startedPendingRoute) {
          this.finishActorMovement(actor, segmentEndsAt);
        }
        changed = true;
        continue;
      }

      if (actor.segmentIndex >= actor.path.length - 1) {
        this.finishActorMovement(actor, segmentEndsAt);
        changed = true;
        break;
      }
    }

    return changed;
  }

  private finishActorMovement(actor: ServerActorState, now: number): void {
    const lastFace = actor.path[actor.path.length - 1];
    if (Number.isFinite(lastFace)) {
      actor.currentFace = lastFace;
    }
    actor.targetFace = null;
    actor.routeTargetFace = null;
    actor.moving = false;
    actor.path = [actor.currentFace];
    actor.segmentDurationsMs = [];
    actor.segmentIndex = 0;
    actor.segmentStartedAtServerMs = now;
    actor.pendingCommandId = null;
    actor.pendingTargetFace = null;
    actor.stateSeq += 1;
  }

  private computeSegmentProgressQ16(actor: ServerActorState, now: number): number {
    if (!actor.moving) {
      return 0;
    }
    const segmentDuration = actor.segmentDurationsMs[actor.segmentIndex] ?? 0;
    if (segmentDuration <= 0) {
      return 0;
    }
    const t = clamp((now - actor.segmentStartedAtServerMs) / segmentDuration, 0, 1);
    return clamp(Math.round(t * 65535), 0, 65535);
  }

  private makeActorSnapshot(actor: ServerActorState, now: number): ActorSnapshot {
    const segmentFromFace = actor.moving ? actor.path[actor.segmentIndex] ?? null : null;
    const segmentToFace = actor.moving ? actor.path[actor.segmentIndex + 1] ?? null : null;
    const segmentDurationMs = actor.moving ? actor.segmentDurationsMs[actor.segmentIndex] ?? 0 : 0;
    return {
      actorId: actor.actorId,
      ownerId: actor.ownerId,
      terrainVersion: this.terrain?.terrainVersion ?? 0,
      stateSeq: actor.stateSeq,
      commandId: actor.commandId,
      moving: actor.moving,
      currentFace: actor.currentFace,
      targetFace: actor.targetFace,
      routeStartFace: actor.routeStartFace,
      routeTargetFace: actor.routeTargetFace,
      routeStartedAtServerMs: actor.routeStartedAtServerMs,
      segmentFromFace: Number.isFinite(segmentFromFace as number) ? (segmentFromFace as number) : null,
      segmentToFace: Number.isFinite(segmentToFace as number) ? (segmentToFace as number) : null,
      segmentDurationMs: Math.max(0, segmentDurationMs),
      segmentTQ16: this.computeSegmentProgressQ16(actor, now),
    };
  }

  private sendTerrainSnapshot(socket: WebSocket): void {
    if (!this.terrain) {
      return;
    }
    this.sendJson(socket, {
      type: 'terrain_snapshot',
      terrainVersion: this.terrain.terrainVersion,
      terrain: this.terrain.snapshot,
      publishedBy: this.hostId ?? '',
      serverTime: Date.now(),
    });
  }

  private sendWorldSnapshot(socket: WebSocket): void {
    const now = Date.now();
    this.advanceAllActors(now);
    const actors = Array.from(this.actorsByPlayerId.values())
      .sort((a, b) => a.actorId.localeCompare(b.actorId))
      .map((actor) => this.makeActorSnapshot(actor, now));

    this.sendJson(socket, {
      type: 'world_snapshot',
      terrainVersion: this.terrain?.terrainVersion ?? 0,
      serverTime: now,
      snapshotSeq: this.snapshotSeq,
      actors,
    });
  }

  private broadcastWorldSnapshot(): void {
    const now = Date.now();
    this.advanceAllActors(now);
    const actors = Array.from(this.actorsByPlayerId.values())
      .sort((a, b) => a.actorId.localeCompare(b.actorId))
      .map((actor) => this.makeActorSnapshot(actor, now));

    this.snapshotSeq += 1;
    this.broadcastJson({
      type: 'world_snapshot',
      terrainVersion: this.terrain?.terrainVersion ?? 0,
      serverTime: now,
      snapshotSeq: this.snapshotSeq,
      actors,
    });

    this.lastSnapshotAt = now;
  }

  private async scheduleNextAlarm(now: number = Date.now()): Promise<void> {
    let nextEdgeAt: number | null = null;

    for (const actor of this.actorsByPlayerId.values()) {
      if (!actor.moving) {
        continue;
      }
      const segmentDuration = actor.segmentDurationsMs[actor.segmentIndex] ?? 0;
      if (segmentDuration <= 0) {
        continue;
      }
      const edgeAt = actor.segmentStartedAtServerMs + segmentDuration;
      if (nextEdgeAt === null || edgeAt < nextEdgeAt) {
        nextEdgeAt = edgeAt;
      }
    }

    if (nextEdgeAt === null) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const heartbeatAt = this.lastSnapshotAt + SNAPSHOT_INTERVAL_MS;
    const nextAlarmAt = Math.max(now + 1, Math.min(nextEdgeAt, heartbeatAt));
    await this.state.storage.setAlarm(nextAlarmAt);
  }

  private parseMessage(data: string | ArrayBuffer): ClientMessage | null {
    if (typeof data !== 'string') {
      return null;
    }

    try {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.type === 'join') {
        return { type: 'join' };
      }
      if (message.type === 'typing') {
        return {
          type: 'typing',
          text: typeof message.text === 'string' ? message.text : '',
        };
      }
      if (message.type === 'launch') {
        return {
          type: 'launch',
          text: typeof message.text === 'string' ? message.text : '',
        };
      }
      if (message.type === 'terrain_publish') {
        const terrain = message.terrain;
        if (!terrain || typeof terrain !== 'object') {
          return null;
        }
        const clientVersion = Math.round(readNumber(message.clientVersion, 0));
        return {
          type: 'terrain_publish',
          terrain: terrain as TerrainSnapshot,
          clientVersion,
        };
      }
      if (message.type === 'actor_move') {
        if (typeof message.actorId !== 'string') {
          return null;
        }
        const targetFace = Math.round(readNumber(message.targetFace, Number.NaN));
        const commandId = Math.round(readNumber(message.commandId, Number.NaN));
        const terrainVersion = Math.round(readNumber(message.terrainVersion, Number.NaN));
        if (!Number.isFinite(targetFace) || !Number.isFinite(commandId) || !Number.isFinite(terrainVersion)) {
          return null;
        }
        return {
          type: 'actor_move',
          actorId: message.actorId,
          targetFace,
          commandId,
          terrainVersion,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private broadcastState(): void {
    const payload = {
      type: 'state',
      players: Array.from(this.connections.values()),
      hostId: this.hostId,
      sessionStart: this.sessionStart,
    };
    this.broadcastJson(payload);
  }

  private broadcastLaunch(text: string, player: PlayerState): void {
    this.history.push({ text, color: player.color, emoji: player.emoji });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    this.broadcastJson({
      type: 'launch',
      text,
      id: player.id,
      color: player.color,
      emoji: player.emoji,
    });
  }

  private sendHistory(socket: WebSocket): void {
    if (this.history.length === 0) {
      return;
    }
    this.sendJson(socket, {
      type: 'history',
      messages: this.history,
    });
  }

  private sendActorReject(
    socket: WebSocket,
    actorId: string,
    commandId: number,
    reason: string,
    terrainVersion: number
  ): void {
    this.sendJson(socket, {
      type: 'actor_reject',
      actorId,
      commandId,
      reason,
      terrainVersion,
    });
  }

  private broadcastJson(payload: object): void {
    const data = JSON.stringify(payload);
    for (const socket of this.connections.keys()) {
      try {
        socket.send(data);
      } catch {
        this.connections.delete(socket);
      }
    }
  }

  private sendJson(socket: WebSocket, payload: object): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.connections.delete(socket);
    }
  }

  private pickEmoji(): string {
    const emoji = this.emojis[Math.floor(Math.random() * this.emojis.length)];
    return emoji ?? '\ud83e\udd34';
  }

  private pickColor(): string {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    return color ?? '#f5f5f5';
  }
}
