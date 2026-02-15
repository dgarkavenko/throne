import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, normalizeRoomConfig } from '../src/room-config';

describe('room-config normalization', () => {
  it('returns defaults when config is missing', () => {
    const normalized = normalizeRoomConfig(null);
    expect(normalized).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('clamps invalid terrain numeric values to safe bounds', () => {
    const normalized = normalizeRoomConfig({
      version: 99,
      terrain: {
        controls: {
          spacing: 1,
          seed: -1,
        },
        mapWidth: 32,
        mapHeight: 100000,
      },
      agents: {
        timePerFaceSeconds: -10,
      },
    });

    expect(normalized.version).toBe(2);
    expect(normalized.terrain.controls.spacing).toBe(16);
    expect(normalized.terrain.controls.seed).toBe(0);
    expect(normalized.terrain.mapWidth).toBe(256);
    expect(normalized.terrain.mapHeight).toBe(4096);
  });

  it('normalizes shape regardless of incoming version and ignores legacy agents', () => {
    const normalized = normalizeRoomConfig({
      version: 0,
      terrain: {
        controls: {
          spacing: 64,
        },
        mapWidth: 1024,
        mapHeight: 768,
      },
      agents: {
        timePerFaceSeconds: 200,
      },
    });

    expect(normalized.version).toBe(2);
    expect(normalized.terrain.controls.spacing).toBe(64);
    expect(normalized.terrain.mapWidth).toBe(1024);
    expect(normalized.terrain.mapHeight).toBe(768);
  });
});
