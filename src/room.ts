import { buildTerrainGeneration } from './terrain/pipeline';
import { buildNavigationGraph, findFacePathAStar, type NavigationGraph } from './client/engine/pathfinding';
import type {
  ActorSnapshot,
  ActorMoveClientMessage,
  AgentsPublishClientMessage,
  ClientMessage,
  TerrainSnapshot,
  TerrainPublishClientMessage,
} from './client/types';
import { normalizeRoomConfig, type RoomConfig } from './room-config';

type PlayerState = {
  id: string;
  emoji: string;
  color: string;
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
const ROOM_CONFIG_STORAGE_KEY = 'room_config_v1';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
  private roomConfig: RoomConfig = normalizeRoomConfig(null);
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
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
    await this.ensureInitialized();

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
    await this.ensureInitialized();

    const now = Date.now();
    const changedActorIds = this.advanceAllActors(now);
    const snapshotDue = now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
    if (changedActorIds.size > 0 || snapshotDue) {
      this.broadcastWorldSnapshot();
    }
    await this.scheduleNextAlarm(now);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.initializePromise) {
      this.initializePromise = this.state.blockConcurrencyWhile(async () => {
        if (this.initialized) {
          return;
        }
        const stored = await this.state.storage.get(ROOM_CONFIG_STORAGE_KEY);
        this.roomConfig = normalizeRoomConfig(stored);
        await this.state.storage.put(ROOM_CONFIG_STORAGE_KEY, this.roomConfig);
        this.terrain = this.buildTerrainRuntime(this.roomConfig);
        this.reseedActorsForTerrain();
        this.initialized = true;
      });
      this.initializePromise = this.initializePromise.finally(() => {
        this.initializePromise = null;
      });
    }
    await this.initializePromise;
  }

  private async saveRoomConfig(config: RoomConfig): Promise<void> {
    this.roomConfig = normalizeRoomConfig(config);
    await this.state.storage.put(ROOM_CONFIG_STORAGE_KEY, this.roomConfig);
  }

  private handleSession(socket: WebSocket): void {
    socket.accept();

    const player: PlayerState = {
      id: crypto.randomUUID(),
      emoji: this.pickEmoji(),
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
        if (this.terrain) {
          this.sendTerrainSnapshot(socket);
          this.sendWorldSnapshot(socket);
        }
        return;
      }

      if (message.type === 'terrain_publish') {
        void this.handleTerrainPublish(socket, player, message);
        return;
      }

      if (message.type === 'agents_publish') {
        void this.handleAgentsPublish(socket, player, message);
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

  private async handleTerrainPublish(
    socket: WebSocket,
    player: PlayerState,
    message: TerrainPublishClientMessage
  ): Promise<void> {
    if (!this.hostId || player.id !== this.hostId) {
      this.sendActorReject(socket, player.id, 0, 'terrain_publish_forbidden', this.terrain?.terrainVersion ?? 0);
      return;
    }

    try {
      const nextConfig = normalizeRoomConfig({
        version: 1,
        terrain: message.terrain,
        agents: this.roomConfig.agents,
      });
      await this.saveRoomConfig(nextConfig);
      this.terrain = this.buildTerrainRuntime(this.roomConfig);
    } catch {
      this.sendActorReject(socket, player.id, 0, 'terrain_publish_invalid', this.terrain?.terrainVersion ?? 0);
      return;
    }

    this.reseedActorsForTerrain();
    this.broadcastTerrainSnapshot(player.id);
    this.broadcastWorldSnapshot();
    void this.scheduleNextAlarm();
  }

  private async handleAgentsPublish(socket: WebSocket, player: PlayerState, message: AgentsPublishClientMessage): Promise<void> {
    if (!this.hostId || player.id !== this.hostId) {
      this.sendActorReject(socket, player.id, 0, 'agents_publish_forbidden', this.terrain?.terrainVersion ?? 0);
      return;
    }

    const now = Date.now();
    this.advanceAllActors(now);
    try {
      const nextConfig = normalizeRoomConfig({
        version: 1,
        terrain: this.roomConfig.terrain,
        agents: message.agents,
      });
      await this.saveRoomConfig(nextConfig);
      this.terrain = this.buildTerrainRuntime(this.roomConfig);
    } catch {
      this.sendActorReject(socket, player.id, 0, 'agents_publish_invalid', this.terrain?.terrainVersion ?? 0);
      return;
    }

    this.recomputeActiveRoutes(now);
    this.broadcastTerrainSnapshot(player.id);
    this.broadcastWorldSnapshot();
    void this.scheduleNextAlarm(now);
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
    startedAtServerMs: number,
    broadcastCommand: boolean = true
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

      if (broadcastCommand) {
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
      }
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

    if (broadcastCommand) {
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
    }
    return true;
  }

  private buildTerrainRuntime(configSnapshot: RoomConfig): TerrainRuntimeState {
    const terrainVersion = (this.terrain?.terrainVersion ?? 0) + 1;
    const normalizedConfig = normalizeRoomConfig(configSnapshot);
    const normalizedSnapshot: TerrainSnapshot = {
      controls: normalizedConfig.terrain.controls,
      movement: normalizedConfig.agents,
      mapWidth: normalizedConfig.terrain.mapWidth,
      mapHeight: normalizedConfig.terrain.mapHeight,
    };

    const config = { width: normalizedSnapshot.mapWidth, height: normalizedSnapshot.mapHeight };
    const generation = buildTerrainGeneration({
      config,
      controls: normalizedSnapshot.controls,
      stopAfter: 'rivers',
    });
    if (!generation.mesh || !generation.water || !generation.rivers) {
      throw new Error('Failed to build terrain generation state');
    }

    const navigationGraph = buildNavigationGraph(generation.mesh.mesh, generation.water.isLand, generation.rivers.riverEdgeMask, {
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

  private recomputeActiveRoutes(now: number): void {
    if (!this.terrain) {
      return;
    }
    for (const actor of this.actorsByPlayerId.values()) {
      const routeTarget = actor.pendingTargetFace ?? actor.routeTargetFace ?? actor.targetFace;
      const commandId = Math.max(actor.commandId, actor.pendingCommandId ?? 0);
      actor.pendingCommandId = null;
      actor.pendingTargetFace = null;

      if (!Number.isFinite(routeTarget as number)) {
        this.finishActorMovement(actor, now);
        continue;
      }

      const started = this.startActorRoute(actor, commandId, routeTarget as number, now, false);
      if (!started) {
        this.finishActorMovement(actor, now);
      }
    }
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

  private broadcastTerrainSnapshot(publishedBy: string): void {
    if (!this.terrain) {
      return;
    }
    this.broadcastJson({
      type: 'terrain_snapshot',
      terrainVersion: this.terrain.terrainVersion,
      terrain: this.terrain.snapshot,
      publishedBy,
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
      if (message.type === 'terrain_publish') {
        const terrain = message.terrain;
        if (!terrain || typeof terrain !== 'object') {
          return null;
        }
        const clientVersion = Math.round(readNumber(message.clientVersion, 0));
        return {
          type: 'terrain_publish',
          terrain: terrain as RoomConfig['terrain'],
          clientVersion,
        };
      }
      if (message.type === 'agents_publish') {
        const agents = message.agents;
        if (!agents || typeof agents !== 'object') {
          return null;
        }
        const clientVersion = Math.round(readNumber(message.clientVersion, 0));
        return {
          type: 'agents_publish',
          agents: agents as RoomConfig['agents'],
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
