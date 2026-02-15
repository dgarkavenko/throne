/**
 * Browser entry for `/game` runtime mode.
 * Branches handled here:
 * - session identity visibility gates for controls
 * - terrain/world snapshot application from room events
 * - debug/control updates routed into shared runtime
 */
import { ClientGame } from '../runtime/modes';
import { connectToRoom } from '../net/connection';
import { createPageLayout } from '../ui/layout';
import {
  createFpsTracker,
  createSessionClientState,
  setRoomRouteLink,
  updateFpsCounter,
  updateSessionTimer,
} from './shared-session';

const GAME_WIDTH = 1560;
const GAME_HEIGHT = 844;

export async function startClientGame(): Promise<void> {
  const state = createSessionClientState();
  const fpsTracker = createFpsTracker();
  const layout = createPageLayout();

  setRoomRouteLink('editor-link', '/editor');

  const engine = new ClientGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    colliderScale: 0.9,
    uiOffset: { x: 24, y: 24 },
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
      updateSessionTimer(state.sessionStart, layout.setSessionElapsed);
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
    updateFpsCounter(now, fpsTracker, layout.setFps);
  });
}
