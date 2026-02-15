import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  normalizeTerrainGenerationControls,
  type TerrainGenerationControls,
} from './terrain/controls';

export type TerrainConfig = {
  controls: TerrainGenerationControls;
  mapWidth: number;
  mapHeight: number;
};

export type RoomConfig = {
  version: 2;
  terrain: TerrainConfig;
};

const DEFAULT_MAP_WIDTH = 1560;
const DEFAULT_MAP_HEIGHT = 844;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  version: 2,
  terrain: {
    controls: { ...DEFAULT_TERRAIN_GENERATION_CONTROLS },
    mapWidth: DEFAULT_MAP_WIDTH,
    mapHeight: DEFAULT_MAP_HEIGHT,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
  const source = raw && typeof raw === 'object' ? (raw as Partial<RoomConfig> & { terrain?: unknown }) : {};
  return {
    version: 2,
    terrain: normalizeTerrainConfig(source.terrain),
  };
}
