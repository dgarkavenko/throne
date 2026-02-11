import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  normalizeTerrainGenerationControls,
  type TerrainGenerationControls,
} from './terrain/controls';

export type AgentsConfig = {
  timePerFaceSeconds: number;
  lowlandThreshold: number;
  impassableThreshold: number;
  elevationPower: number;
  elevationGainK: number;
  riverPenalty: number;
};

export type TerrainConfig = {
  controls: TerrainGenerationControls;
  mapWidth: number;
  mapHeight: number;
};

export type RoomConfig = {
  version: 1;
  terrain: TerrainConfig;
  agents: AgentsConfig;
};

const DEFAULT_MAP_WIDTH = 1560;
const DEFAULT_MAP_HEIGHT = 844;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  version: 1,
  terrain: {
    controls: { ...DEFAULT_TERRAIN_GENERATION_CONTROLS },
    mapWidth: DEFAULT_MAP_WIDTH,
    mapHeight: DEFAULT_MAP_HEIGHT,
  },
  agents: {
    timePerFaceSeconds: 180,
    lowlandThreshold: 10,
    impassableThreshold: 28,
    elevationPower: 0.8,
    elevationGainK: 1,
    riverPenalty: 0.8,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeAgentsConfig(raw: unknown): AgentsConfig {
  const source = raw && typeof raw === 'object' ? (raw as Partial<AgentsConfig>) : {};
  const defaults = DEFAULT_ROOM_CONFIG.agents;
  const lowlandThreshold = clamp(Math.round(readNumber(source.lowlandThreshold, defaults.lowlandThreshold)), 1, 31);
  const impassableThresholdInput = clamp(
    Math.round(readNumber(source.impassableThreshold, defaults.impassableThreshold)),
    2,
    32
  );
  return {
    timePerFaceSeconds: clamp(Math.round(readNumber(source.timePerFaceSeconds, defaults.timePerFaceSeconds)), 1, 600),
    lowlandThreshold,
    impassableThreshold: clamp(Math.max(lowlandThreshold + 1, impassableThresholdInput), 2, 32),
    elevationPower: clamp(readNumber(source.elevationPower, defaults.elevationPower), 0.5, 2),
    elevationGainK: clamp(readNumber(source.elevationGainK, defaults.elevationGainK), 0, 4),
    riverPenalty: clamp(readNumber(source.riverPenalty, defaults.riverPenalty), 0, 8),
  };
}

function normalizeTerrainConfig(raw: unknown): TerrainConfig {
  const source = raw && typeof raw === 'object' ? (raw as Partial<TerrainConfig>) : {};
  const defaults = DEFAULT_ROOM_CONFIG.terrain;
  return {
    controls: normalizeTerrainGenerationControls(source.controls),
    mapWidth: clamp(Math.round(readNumber(source.mapWidth, defaults.mapWidth)), 256, 4096),
    mapHeight: clamp(Math.round(readNumber(source.mapHeight, defaults.mapHeight)), 256, 4096),
  };
}

export function normalizeRoomConfig(raw: unknown): RoomConfig {
  const source = raw && typeof raw === 'object' ? (raw as Partial<RoomConfig>) : {};
  return {
    version: 1,
    terrain: normalizeTerrainConfig(source.terrain),
    agents: normalizeAgentsConfig(source.agents),
  };
}

