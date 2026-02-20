/**
 * Browser entry for `/editor` runtime mode.
 * Branches handled here:
 * - host vs non-host terrain control authorization
 * - local terrain edits vs synchronized terrain snapshots
 * - terrain publish action routing to room protocol
 */
import { EditorGame } from '../runtime/modes';
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

export async function startClientEditor(): Promise<void> {
  const state = createSessionClientState();
  const fpsTracker = createFpsTracker();
  const layout = createPageLayout();

  setRoomRouteLink('game-link', '/game');

  const rendererType = new URLSearchParams(window.location.search).get('renderer') === 'pixi' ? 'pixi' : 'three';

  const engine = new EditorGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    autoGenerateTerrain: true,
    rendererType,
  });

  await engine.init(layout.field);
  const generationSettings = layout.getTerrainGenerationSettings();
  const renderSettings = layout.getTerrainRenderSettings();
  engine.setTerrainGenerationControls(generationSettings);
  engine.setTerrainRenderControls(renderSettings);

  const syncSettingsAccess = (): void => {
    const hasSessionIdentity = state.playerId !== null && state.hostId !== null;
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
    layout.setTerrainSyncStatus('Local changes');
  });

  const connection = connectToRoom({
    onStatus: layout.setStatus,
    onConnected: () => layout.setConnected(true),
    onDisconnected: () => layout.setConnected(false),
    onWelcome: (playerId) => {
      state.playerId = playerId;
      syncSettingsAccess();
    },
    onState: (players, sessionStart, hostId) => {
      state.players = players;
      state.sessionStart = sessionStart;
      state.hostId = hostId;
      syncSettingsAccess();
      updateSessionTimer(state.sessionStart, layout.setSessionElapsed);
    },
    onTerrainSnapshot: (message) => {
      layout.setTerrainGenerationSettings(message.terrain.controls);
      engine.applyTerrainSnapshot(message.terrain, message.terrainVersion);
      engine.setTerrainRenderControls(layout.getTerrainRenderSettings());
      layout.setTerrainSyncStatus(`v${message.terrainVersion}`);
    },
    onWorldSnapshot: () => {},
  });

  layout.onPublishTerrain(() => {
    if (state.playerId === null || state.hostId === null || state.playerId !== state.hostId) {
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

}
