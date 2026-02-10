import type { TerrainGenerationControls } from '../terrain/controls';

export interface PlayerState {
  id: string;
  emoji: string;
  typing: string;
  color: string;
}

export interface HistoryEntry {
  text: string;
  color: string;
  emoji: string;
}

export interface TerrainSnapshot {
  controls: TerrainGenerationControls;
  movement: {
    timePerFaceSeconds: number;
    lowlandThreshold: number;
    impassableThreshold: number;
    elevationPower: number;
    elevationGainK: number;
    riverPenalty: number;
  };
  mapWidth: number;
  mapHeight: number;
}

export interface ActorSnapshot {
  actorId: string;
  ownerId: string;
  terrainVersion: number;
  stateSeq: number;
  commandId: number;
  moving: boolean;
  currentFace: number;
  targetFace: number | null;
  routeStartFace: number;
  routeTargetFace: number | null;
  routeStartedAtServerMs: number;
  segmentFromFace: number | null;
  segmentToFace: number | null;
  segmentDurationMs: number;
  segmentTQ16: number;
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

export interface HistoryMessage {
  type: 'history';
  messages: HistoryEntry[];
}

export interface LaunchMessage {
  type: 'launch';
  text: string;
  id: string;
  color: string;
  emoji: string;
}

export interface TerrainSnapshotMessage {
  type: 'terrain_snapshot';
  terrainVersion: number;
  terrain: TerrainSnapshot;
  publishedBy: string;
  serverTime: number;
}

export interface ActorCommandMessage {
  type: 'actor_command';
  actorId: string;
  ownerId: string;
  commandId: number;
  startFace: number;
  targetFace: number;
  startedAt: number;
  routeStartedAtServerMs: number;
  terrainVersion: number;
}

export interface WorldSnapshotMessage {
  type: 'world_snapshot';
  terrainVersion: number;
  serverTime: number;
  snapshotSeq: number;
  actors: ActorSnapshot[];
}

export interface ActorRejectMessage {
  type: 'actor_reject';
  actorId: string;
  commandId: number;
  reason: string;
  terrainVersion: number;
}

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | HistoryMessage
  | LaunchMessage
  | TerrainSnapshotMessage
  | ActorCommandMessage
  | WorldSnapshotMessage
  | ActorRejectMessage;

export interface JoinClientMessage {
  type: 'join';
}

export interface TypingClientMessage {
  type: 'typing';
  text: string;
}

export interface LaunchClientMessage {
  type: 'launch';
  text: string;
}

export interface TerrainPublishClientMessage {
  type: 'terrain_publish';
  terrain: TerrainSnapshot;
  clientVersion: number;
}

export interface ActorMoveClientMessage {
  type: 'actor_move';
  actorId: string;
  targetFace: number;
  commandId: number;
  terrainVersion: number;
}

export type ClientMessage =
  | JoinClientMessage
  | TypingClientMessage
  | LaunchClientMessage
  | TerrainPublishClientMessage
  | ActorMoveClientMessage;
