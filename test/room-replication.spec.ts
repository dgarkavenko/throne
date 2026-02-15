import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { TerrainSnapshot } from '../src/shared/protocol';
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

describe.skip('room replication v2 (requires non-isolated DO websocket integration runtime)', () => {
  it('emits spawn-only actor snapshot schema after terrain publish', async () => {
    const roomId = `rep-v2-${Date.now()}-schema`;
    const socket = await openRoom(roomId);
    try {
      await socket.next((message) => message.type === 'welcome');
      socket.send({ type: 'join' });

      socket.send({
        type: 'terrain_publish',
        terrain: {
          controls: DEFAULT_SNAPSHOT.controls,
          mapWidth: DEFAULT_SNAPSHOT.mapWidth,
          mapHeight: DEFAULT_SNAPSHOT.mapHeight,
        },
        clientVersion: 1,
      });

      await socket.next((message) => message.type === 'terrain_snapshot');
      const worldSnapshot = await socket.next((message) => message.type === 'world_snapshot');
      expect(worldSnapshot.snapshotSeq).toBeTypeOf('number');
      const actors = worldSnapshot.actors as AnyMessage[];
      expect(Array.isArray(actors)).toBe(true);
      expect(actors.length).toBeGreaterThan(0);
      const actor = actors[0];
      expect(typeof actor.actorId).toBe('string');
      expect(typeof actor.ownerId).toBe('string');
      expect(typeof actor.currentFace).toBe('number');
      expect(actor.commandId).toBeUndefined();
      expect(actor.routeTargetFace).toBeUndefined();
      expect(actor.segmentFromFace).toBeUndefined();
    } finally {
      await socket.close();
    }
  }, 15000);

  it('keeps actor set stable across snapshots without movement updates', async () => {
    const roomId = `rep-v2-${Date.now()}-stable`;
    const socket = await openRoom(roomId);
    try {
      await socket.next((message) => message.type === 'welcome');
      socket.send({ type: 'join' });

      socket.send({
        type: 'terrain_publish',
        terrain: {
          controls: DEFAULT_SNAPSHOT.controls,
          mapWidth: DEFAULT_SNAPSHOT.mapWidth,
          mapHeight: DEFAULT_SNAPSHOT.mapHeight,
        },
        clientVersion: 1,
      });

      await socket.next((message) => message.type === 'terrain_snapshot');
      const snapA = await socket.next((message) => message.type === 'world_snapshot');
      const idsA = ((snapA.actors as AnyMessage[]) || []).map((a) => String(a.actorId)).sort();

      socket.send({ type: 'join' });
      const snapB = await socket.next((message) => message.type === 'world_snapshot' && Number(message.snapshotSeq) >= Number(snapA.snapshotSeq));
      const idsB = ((snapB.actors as AnyMessage[]) || []).map((a) => String(a.actorId)).sort();

      expect(idsB).toEqual(idsA);
    } finally {
      await socket.close();
    }
  }, 15000);
});
