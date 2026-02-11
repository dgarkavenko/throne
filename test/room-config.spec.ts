import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, normalizeRoomConfig } from '../src/room-config';

describe('room-config normalization', () => {
  it('returns defaults when config is missing', () => {
    const normalized = normalizeRoomConfig(null);
    expect(normalized).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('clamps invalid numeric values to safe bounds', () => {
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
        lowlandThreshold: -5,
        impassableThreshold: 1000,
        elevationPower: 7,
        elevationGainK: -3,
        riverPenalty: 100,
      },
    });

    expect(normalized.version).toBe(1);
    expect(normalized.terrain.controls.spacing).toBe(16);
    expect(normalized.terrain.controls.seed).toBe(0);
    expect(normalized.terrain.mapWidth).toBe(256);
    expect(normalized.terrain.mapHeight).toBe(4096);
    expect(normalized.agents.timePerFaceSeconds).toBe(1);
    expect(normalized.agents.lowlandThreshold).toBe(1);
    expect(normalized.agents.impassableThreshold).toBe(32);
    expect(normalized.agents.elevationPower).toBe(2);
    expect(normalized.agents.elevationGainK).toBe(0);
    expect(normalized.agents.riverPenalty).toBe(8);
  });

  it('normalizes shape regardless of incoming version', () => {
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
        lowlandThreshold: 9,
        impassableThreshold: 12,
        elevationPower: 0.9,
        elevationGainK: 1.2,
        riverPenalty: 0.4,
      },
    });

    expect(normalized.version).toBe(1);
    expect(normalized.terrain.controls.spacing).toBe(64);
    expect(normalized.terrain.mapWidth).toBe(1024);
    expect(normalized.terrain.mapHeight).toBe(768);
    expect(normalized.agents.timePerFaceSeconds).toBe(200);
    expect(normalized.agents.lowlandThreshold).toBe(9);
    expect(normalized.agents.impassableThreshold).toBe(12);
    expect(normalized.agents.elevationPower).toBe(0.9);
    expect(normalized.agents.elevationGainK).toBe(1.2);
    expect(normalized.agents.riverPenalty).toBe(0.4);
  });
});

