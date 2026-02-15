import type { TerrainGenerationControls } from '../terrain/controls';

export interface TerrainConfig {
  controls: TerrainGenerationControls;
  mapWidth: number;
  mapHeight: number;
}

export interface PlayerState {
  id: string;
  emoji: string;
  color: string;
}

export interface TerrainSnapshot {
  controls: TerrainGenerationControls;
  mapWidth: number;
  mapHeight: number;
}

export interface ActorSnapshot {
  actorId: string;
  ownerId: string;
  currentFace: number;
}

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
}

export interface StateMessage {
  type: 'state';
  players: PlayerState[];
  hostId: string | null;
  sessionStart: number | null;
}

export interface TerrainSnapshotMessage {
  type: 'terrain_snapshot';
  terrainVersion: number;
  terrain: TerrainSnapshot;
  publishedBy: string;
  serverTime: number;
}

export interface WorldSnapshotMessage {
  type: 'world_snapshot';
  terrainVersion: number;
  serverTime: number;
  snapshotSeq: number;
  actors: ActorSnapshot[];
}

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | TerrainSnapshotMessage
  | WorldSnapshotMessage;

export interface JoinClientMessage {
  type: 'join';
}

export interface TerrainPublishClientMessage {
  type: 'terrain_publish';
  terrain: TerrainConfig;
  clientVersion: number;
}

export type ClientMessage = JoinClientMessage | TerrainPublishClientMessage;
