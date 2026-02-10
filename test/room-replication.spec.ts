import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildNavigationGraph, findFacePathAStar } from '../src/client/engine/pathfinding';
import type { TerrainSnapshot } from '../src/client/types';
import { buildTerrainGeneration } from '../src/terrain/pipeline';
import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  type TerrainGenerationControls,
} from '../src/terrain/controls';

type AnyMessage = Record<string, unknown>;

class MessageSocket {
  private closed = false;
  private readonly queue: AnyMessage[] = [];
  private readonly waiters: Array<{
    predicate: (message: AnyMessage) => boolean;
    resolve: (message: AnyMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse((event as MessageEvent).data as string) as AnyMessage;
      this.push(payload);
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      this.rejectAllWaiters(new Error('Socket closed'));
    });
    socket.addEventListener('error', () => {
      this.rejectAllWaiters(new Error('Socket error'));
    });
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed || this.socket.readyState >= WebSocket.CLOSING) {
      this.closed = true;
      this.rejectAllWaiters(new Error('Socket closed'));
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      this.socket.addEventListener(
        'close',
        () => {
          clearTimeout(timer);
          this.closed = true;
          resolve();
        },
        { once: true }
      );
      this.socket.close(1000, 'test done');
    });
    this.rejectAllWaiters(new Error('Socket closed'));
  }

  async next(predicate: (message: AnyMessage) => boolean, timeoutMs = 5000): Promise<AnyMessage> {
    if (this.closed) {
      throw new Error('Socket is closed');
    }
    for (let i = 0; i < this.queue.length; i += 1) {
      const message = this.queue[i];
      if (!predicate(message)) {
        continue;
      }
      this.queue.splice(i, 1);
      return message;
    }

    return new Promise<AnyMessage>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(new Error('Timed out waiting for websocket message'));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      const wrappedResolve = (message: AnyMessage) => {
        clearTimeout(waiter.timer);
        resolve(message);
      };
      waiter.resolve = wrappedResolve;
    });
  }

  private push(message: AnyMessage): void {
    for (let i = 0; i < this.waiters.length; i += 1) {
      const waiter = this.waiters[i];
      if (!waiter.predicate(message)) {
        continue;
      }
      this.waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    this.queue.push(message);
  }

  private rejectAllWaiters(error: Error): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.pop();
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

const DEFAULT_CONTROLS: TerrainGenerationControls = {
  ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
  spacing: 64,
};

const DEFAULT_SNAPSHOT: TerrainSnapshot = {
  controls: DEFAULT_CONTROLS,
  movement: {
    timePerFaceSeconds: 180,
    lowlandThreshold: 10,
    impassableThreshold: 28,
    elevationPower: 0.8,
    elevationGainK: 1,
    riverPenalty: 0.8,
  },
  mapWidth: 512,
  mapHeight: 512,
};

async function openRoom(roomId: string): Promise<MessageSocket> {
  const response = await SELF.fetch(`https://example.com/room/${roomId}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).toBeTruthy();
  socket!.accept();
  return new MessageSocket(socket!);
}

function pickReachableTarget(startFace: number): number | null {
  const config = { width: DEFAULT_SNAPSHOT.mapWidth, height: DEFAULT_SNAPSHOT.mapHeight };
  const generation = buildTerrainGeneration({
    config,
    controls: DEFAULT_CONTROLS,
    stopAfter: 'rivers',
  });
  if (!generation.mesh || !generation.water || !generation.rivers) {
    return null;
  }
  const graph = buildNavigationGraph(generation.mesh.mesh, generation.water.isLand, generation.rivers.riverEdgeMask, {
    lowlandThreshold: DEFAULT_SNAPSHOT.movement.lowlandThreshold,
    impassableThreshold: DEFAULT_SNAPSHOT.movement.impassableThreshold,
    elevationPower: DEFAULT_SNAPSHOT.movement.elevationPower,
    elevationGainK: DEFAULT_SNAPSHOT.movement.elevationGainK,
    riverPenalty: DEFAULT_SNAPSHOT.movement.riverPenalty,
  });
  if (!graph.nodes[startFace]) {
    return null;
  }
  for (let i = 0; i < graph.landFaceIds.length; i += 1) {
    const candidate = graph.landFaceIds[i];
    if (candidate === startFace) {
      continue;
    }
    const route = findFacePathAStar(graph, startFace, candidate);
    if (route.facePath.length >= 2) {
      return candidate;
    }
  }
  return null;
}

describe.skip('room replication v2 (requires non-isolated DO websocket integration runtime)', () => {
  it('emits v2 actor snapshot schema after terrain publish', async () => {
    const roomId = `rep-v2-${Date.now()}-schema`;
    const socket = await openRoom(roomId);
    try {
      const welcome = await socket.next((message) => message.type === 'welcome');
      const playerId = String(welcome.id);
      socket.send({ type: 'join' });

      socket.send({
        type: 'terrain_publish',
        terrain: DEFAULT_SNAPSHOT,
        clientVersion: 1,
      });

      const terrainSnapshot = await socket.next((message) => message.type === 'terrain_snapshot');
      expect(terrainSnapshot.terrainVersion).toBeTypeOf('number');

      const worldSnapshot = await socket.next((message) => message.type === 'world_snapshot');
      expect(worldSnapshot.snapshotSeq).toBeTypeOf('number');
      const actors = worldSnapshot.actors as AnyMessage[];
      expect(Array.isArray(actors)).toBe(true);
      const selfActor = actors.find((actor) => String(actor.actorId) === playerId);
      expect(selfActor).toBeTruthy();
      expect(selfActor?.stateSeq).toBeTypeOf('number');
      expect(selfActor?.routeStartFace).toBeTypeOf('number');
      expect(selfActor?.routeTargetFace ?? null).toBe(null);
      expect(selfActor?.segmentFromFace ?? null).toBe(null);
      expect(selfActor?.segmentToFace ?? null).toBe(null);
    } finally {
      await socket.close();
    }
  }, 15000);

  it('accepts actor_move and emits authoritative edge-state snapshots', async () => {
    const roomId = `rep-v2-${Date.now()}-move`;
    const socket = await openRoom(roomId);
    try {
      const welcome = await socket.next((message) => message.type === 'welcome');
      const playerId = String(welcome.id);
      socket.send({ type: 'join' });

      socket.send({
        type: 'terrain_publish',
        terrain: DEFAULT_SNAPSHOT,
        clientVersion: 1,
      });
      await socket.next((message) => message.type === 'terrain_snapshot');
      const initialWorld = await socket.next((message) => message.type === 'world_snapshot');
      const terrainVersion = Number(initialWorld.terrainVersion);
      const selfActor = (initialWorld.actors as AnyMessage[]).find((actor) => String(actor.actorId) === playerId);
      expect(selfActor).toBeTruthy();
      const startFace = Number(selfActor?.currentFace);
      const targetFace = pickReachableTarget(startFace);
      expect(targetFace).not.toBeNull();

      socket.send({
        type: 'actor_move',
        actorId: playerId,
        targetFace,
        commandId: 1,
        terrainVersion,
      });

      const actorCommand = await socket.next(
        (message) => message.type === 'actor_command' && String(message.actorId) === playerId
      );
      expect(actorCommand.routeStartedAtServerMs).toBeTypeOf('number');

      const movingSnapshot = await socket.next(
        (message) =>
          message.type === 'world_snapshot' &&
          Array.isArray(message.actors) &&
          (message.actors as AnyMessage[]).some(
            (actor) => String(actor.actorId) === playerId && Boolean(actor.moving)
          )
      );
      const movingActor = (movingSnapshot.actors as AnyMessage[]).find((actor) => String(actor.actorId) === playerId);
      expect(movingActor?.segmentFromFace).toBeTypeOf('number');
      expect(movingActor?.segmentToFace).toBeTypeOf('number');
      expect(movingActor?.segmentDurationMs).toBeGreaterThan(0);
      expect(movingActor?.stateSeq).toBeGreaterThan(0);

      const seqA = Number(movingSnapshot.snapshotSeq);
      const stateSeqA = Number(movingActor?.stateSeq);
      const nextSnapshot = await socket.next(
        (message) =>
          message.type === 'world_snapshot' &&
          Number(message.snapshotSeq) > seqA &&
          Array.isArray(message.actors)
      );
      const nextActor = (nextSnapshot.actors as AnyMessage[]).find((actor) => String(actor.actorId) === playerId);
      expect(Number(nextSnapshot.snapshotSeq)).toBeGreaterThan(seqA);
      expect(Number(nextActor?.stateSeq)).toBeGreaterThanOrEqual(stateSeqA);
    } finally {
      await socket.close();
    }
  }, 15000);
});
