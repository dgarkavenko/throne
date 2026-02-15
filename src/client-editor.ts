import { EditorGame } from './client/game/editor-game';
import { connectToRoom } from './client/net/connection';
import { createPageLayout } from './client/ui/layout';
import type { PlayerState } from './client/types';

const GAME_WIDTH = 1560;
const GAME_HEIGHT = 844;

type ClientState = {
  playerId: string | null;
  hostId: string | null;
  sessionStart: number | null;
  sessionTimerId: number | null;
  players: PlayerState[];
};

const state: ClientState = {
  playerId: null,
  hostId: null,
  sessionStart: null,
  sessionTimerId: null,
  players: [],
};

const fpsTracker = {
  lastSample: performance.now(),
  frames: 0,
};

function updateFpsCounter(now: number, setFps: (fps: number | null) => void): void {
  fpsTracker.frames += 1;
  const elapsed = now - fpsTracker.lastSample;
  if (elapsed < 500) {
    return;
  }
  const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
  setFps(fps);
  fpsTracker.frames = 0;
  fpsTracker.lastSample = now;
}

function updateSessionTimer(setSessionElapsed: (elapsedMs: number | null) => void): void {
  if (!state.sessionStart) {
    setSessionElapsed(null);
    return;
  }
  setSessionElapsed(Date.now() - state.sessionStart);
}

async function startClientEditor(): Promise<void> {
  const layout = createPageLayout();
  const gameLink = document.getElementById('game-link') as HTMLAnchorElement | null;
  if (gameLink) {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    gameLink.href = roomId ? `/game?room=${encodeURIComponent(roomId)}` : '/game';
  }
  const engine = new EditorGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    colliderScale: 0.9,
    uiOffset: { x: 24, y: 24 },
    autoGenerateTerrain: true,
  });

  await engine.init(layout.field);
  const generationSettings = layout.getTerrainGenerationSettings();
  const renderSettings = layout.getTerrainRenderSettings();
  const movementSettings = layout.getMovementSettings();
  engine.setTerrainGenerationControls(generationSettings);
  engine.setTerrainRenderControls(renderSettings);
  engine.setMovementTestConfig({
    showPaths: movementSettings.debugPaths,
  });

  const syncSettingsAccess = (): void => {
    const hasSessionIdentity = Boolean(state.playerId) && Boolean(state.hostId);
    if (!hasSessionIdentity) {
      layout.setSettingsVisible(false);
      layout.setTerrainPublishVisible(false);
      return;
    }
    const isHost = state.playerId === state.hostId;
    layout.setSettingsVisible(true);
    layout.setDebugControlsOnly(false);
    layout.setTerrainControlsEnabled(isHost);
    layout.setAgentControlsEnabled(false);
    layout.setTerrainPublishVisible(isHost);
  };

  layout.setSettingsVisible(false);
  layout.setDebugControlsOnly(false);
  layout.setTerrainControlsEnabled(false);
  layout.setTerrainPublishVisible(false);
  layout.setTerrainSyncStatus('Unsynced');
  layout.onTerrainSettingsChange((nextSettings) => {
    engine.setTerrainGenerationControls(nextSettings.generation);
    engine.setTerrainRenderControls(nextSettings.render);
    engine.setMovementTestConfig({
      showPaths: nextSettings.movement.debugPaths,
    });
    layout.setTerrainSyncStatus('Local changes');
  });

  const connection = connectToRoom({
    onStatus: layout.setStatus,
    onConnected: () => layout.setConnected(true),
    onDisconnected: () => layout.setConnected(false),
    onWelcome: (playerId) => {
      state.playerId = playerId;
      engine.setLocalPlayerId(playerId);
      syncSettingsAccess();
    },
    onState: (players, sessionStart, hostId) => {
      state.players = players;
      state.sessionStart = sessionStart;
      state.hostId = hostId;
      syncSettingsAccess();
      updateSessionTimer(layout.setSessionElapsed);
    },
    onTerrainSnapshot: (message) => {
      layout.setTerrainGenerationSettings(message.terrain.controls);
      engine.applyTerrainSnapshot(message.terrain, message.terrainVersion);
      engine.setTerrainRenderControls(layout.getTerrainRenderSettings());
      engine.setMovementTestConfig({
        showPaths: layout.getMovementSettings().debugPaths,
      });
      layout.setTerrainSyncStatus(`v${message.terrainVersion}`);
    },
    onWorldSnapshot: (message) => {
      engine.applyWorldSnapshot(message);
    }
  });

  layout.onPublishTerrain(() => {
    if (!state.playerId || !state.hostId || state.playerId !== state.hostId) {
      return;
    }
    const snapshot = engine.getTerrainSnapshotForReplication();
    connection.publishTerrainConfig({
      controls: snapshot.controls,
      mapWidth: snapshot.mapWidth,
      mapHeight: snapshot.mapHeight,
    });
    layout.setTerrainSyncStatus('Publishing...');
  });

  engine.bindAndStart((_deltaMs, now) => {
    updateFpsCounter(now, layout.setFps);
  });
}

void startClientEditor();
