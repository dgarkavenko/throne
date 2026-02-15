import { GameEngine } from './client/engine/game-engine';
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

function updateSessionTimer(setSessionElapsed: (elapsedMs: number | null) => void): void {
  if (!state.sessionStart) {
    setSessionElapsed(null);
    return;
  }
  setSessionElapsed(Date.now() - state.sessionStart);
}

async function startClientGame(): Promise<void> {
  const layout = createPageLayout();
  const editorLink = document.getElementById('editor-link') as HTMLAnchorElement | null;

  if (editorLink) {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    editorLink.href = roomId ? `/editor?room=${encodeURIComponent(roomId)}` : '/editor';
  }

  const engine = new GameEngine({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    colliderScale: 0.9,
    uiOffset: { x: 24, y: 24 },
    autoGenerateTerrain: false,
  });

  await engine.init(layout.field);
  layout.setSettingsVisible(false);
  layout.setDebugControlsOnly(false);
  layout.setTerrainControlsEnabled(false);
  layout.setTerrainPublishVisible(false);
  layout.setAgentControlsEnabled(false);
  engine.setTerrainRenderControls(layout.getTerrainRenderSettings());
  engine.setMovementTestConfig({
    showPaths: layout.getMovementSettings().debugPaths,
  });

  const syncHostAccess = (): void => {
    const hasSessionIdentity = Boolean(state.playerId) && Boolean(state.hostId);
    layout.setSettingsVisible(hasSessionIdentity);
    layout.setAgentControlsEnabled(false);
  };

  const connection = connectToRoom({
    onStatus: layout.setStatus,
    onConnected: () => layout.setConnected(true),
    onDisconnected: () => layout.setConnected(false),
    onWelcome: (playerId) => {
      state.playerId = playerId;
      engine.setLocalPlayerId(playerId);
      syncHostAccess();
    },
    onState: (players, sessionStart, hostId) => {
      state.players = players;
      state.sessionStart = sessionStart;
      state.hostId = hostId;
      syncHostAccess();
      updateSessionTimer(layout.setSessionElapsed);
    },
    onTerrainSnapshot: (message) => {
      engine.applyTerrainSnapshot(message.terrain, message.terrainVersion);
      engine.setTerrainRenderControls(layout.getTerrainRenderSettings());
      engine.setMovementTestConfig({
        showPaths: layout.getMovementSettings().debugPaths,
      });
      layout.setStatus(`Terrain synced v${message.terrainVersion}`);
    },
    onWorldSnapshot: (message) => {
      engine.applyWorldSnapshot(message);
      layout.setSessionElapsed(message.serverTime);
    },
  });

  void connection;

  layout.onTerrainSettingsChange((nextSettings) => {
    engine.setTerrainRenderControls(nextSettings.render);
    engine.setMovementTestConfig({
      showPaths: nextSettings.movement.debugPaths,
    });
  });

  engine.bindAndStart((deltaMs, now) => {
    void deltaMs;

    fpsTracker.frames += 1;
    const elapsed = now - fpsTracker.lastSample;
    if (elapsed >= 500) {
      const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
      layout.setFps(fps);
      fpsTracker.frames = 0;
      fpsTracker.lastSample = now;
    }
  });
}

void startClientGame();
