import { buildTerrainGeneration } from './terrain/pipeline';
import type { ActorSnapshot, ClientMessage, TerrainSnapshot, TerrainPublishClientMessage } from './client/types';
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
};

type TerrainRuntimeState = {
  terrainVersion: number;
  snapshot: TerrainSnapshot;
  landFaceIds: number[];
};

const ROOM_CONFIG_STORAGE_KEY = 'room_config_v2';

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
  private actorsById = new Map<string, ServerActorState>();
  private snapshotSeq = 0;

  private readonly emojis = [
    '??',
    '??',
    '??',
    '??',
    '?????',
    '?????',
    '??',
    '?????',
    '?????',
    '??',
    '?????',
    '?????',
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

  constructor(private readonly state: DurableObjectState, private readonly env: unknown) {
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
        this.reseedStartingActors();
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

    this.sendJson(socket, {
      type: 'welcome',
      id: player.id,
    });

    this.broadcastState();

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
      }
    });

    const cleanup = () => {
      this.connections.delete(socket);

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
      return;
    }

    try {
      const nextConfig = normalizeRoomConfig({
        version: 2,
        terrain: message.terrain,
      });
      await this.saveRoomConfig(nextConfig);
      this.terrain = this.buildTerrainRuntime(this.roomConfig);
    } catch {
      return;
    }

    this.reseedStartingActors();
    this.broadcastTerrainSnapshot(player.id);
    this.broadcastWorldSnapshot();
    void socket;
  }

  private buildTerrainRuntime(configSnapshot: RoomConfig): TerrainRuntimeState {
    const terrainVersion = (this.terrain?.terrainVersion ?? 0) + 1;
    const normalizedConfig = normalizeRoomConfig(configSnapshot);
    const normalizedSnapshot: TerrainSnapshot = {
      controls: normalizedConfig.terrain.controls,
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

    const landFaceIds: number[] = [];
    for (let i = 0; i < generation.water.isLand.length; i += 1) {
      if (generation.water.isLand[i]) {
        landFaceIds.push(i);
      }
    }

    return {
      terrainVersion,
      snapshot: normalizedSnapshot,
      landFaceIds,
    };
  }

  private reseedStartingActors(): void {
    if (!this.terrain) {
      this.actorsById.clear();
      return;
    }

    const nextActors = new Map<string, ServerActorState>();
    const numActors = 12;

    for (let i = 0; i < numActors; i += 1) {
      const actorId = `actor${i}`;
      const ownerId = `house${i % 4}`;
      const spawnFace = this.pickSpawnFace(actorId);
      if (spawnFace === null) {
        continue;
      }
      nextActors.set(actorId, {
        actorId,
        ownerId,
        currentFace: spawnFace,
      });
    }

    this.actorsById = nextActors;
  }

  private pickSpawnFace(seedId: string): number | null {
    if (!this.terrain) {
      return null;
    }
    const faceIds = this.terrain.landFaceIds;
    if (faceIds.length === 0) {
      return null;
    }
    const hash = fnv1aHash32(`${this.terrain.terrainVersion}:${seedId}`);
    return faceIds[hash % faceIds.length] ?? null;
  }

  private makeActorSnapshot(actor: ServerActorState): ActorSnapshot {
    return {
      actorId: actor.actorId,
      ownerId: actor.ownerId,
      currentFace: actor.currentFace,
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
    const actors = Array.from(this.actorsById.values())
      .sort((a, b) => a.actorId.localeCompare(b.actorId))
      .map((actor) => this.makeActorSnapshot(actor));

    this.sendJson(socket, {
      type: 'world_snapshot',
      terrainVersion: this.terrain?.terrainVersion ?? 0,
      serverTime: Date.now(),
      snapshotSeq: this.snapshotSeq,
      actors,
    });
  }

  private broadcastWorldSnapshot(): void {
    const actors = Array.from(this.actorsById.values())
      .sort((a, b) => a.actorId.localeCompare(b.actorId))
      .map((actor) => this.makeActorSnapshot(actor));

    this.snapshotSeq += 1;
    this.broadcastJson({
      type: 'world_snapshot',
      terrainVersion: this.terrain?.terrainVersion ?? 0,
      serverTime: Date.now(),
      snapshotSeq: this.snapshotSeq,
      actors,
    });
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
    return emoji ?? '??';
  }

  private pickColor(): string {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    return color ?? '#f5f5f5';
  }
}
