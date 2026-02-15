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
import
	{
		createFpsTracker,
		createSessionClientState,
		setRoomRouteLink,
		updateFpsCounter,
		updateSessionTimer,
	} from './shared-session';

const GAME_WIDTH = 1560;
const GAME_HEIGHT = 844;

export async function startClientGame(): Promise<void>
{
	const state = createSessionClientState();
	const fpsTracker = createFpsTracker();
	const layout = createPageLayout();

	setRoomRouteLink('editor-link', '/editor');

	const clientGame = new ClientGame({
		width: GAME_WIDTH,
		height: GAME_HEIGHT,
	});

	await clientGame.init(layout.field);
	layout.setSettingsVisible(false);
	layout.setDebugControlsOnly(false);
	layout.setTerrainControlsEnabled(false);
	layout.setTerrainPublishVisible(false);
	layout.setAgentControlsEnabled(false);

	clientGame.setTerrainRenderControls(layout.getTerrainRenderSettings());
	clientGame.setMovementTestConfig({
		showPaths: layout.getMovementSettings().debugPaths,
	});

	const syncHostAccess = (): void =>
	{
		const hasSessionIdentity = state.playerId !== null && state.hostId !== null;
		layout.setSettingsVisible(hasSessionIdentity);
		layout.setAgentControlsEnabled(false);
	};

	const connection = connectToRoom({
		onStatus: layout.setStatus,
		onConnected: () => layout.setConnected(true),
		onDisconnected: () => layout.setConnected(false),
		onWelcome: (playerId) =>
		{
			state.playerId = playerId;
			clientGame.setLocalPlayerId(playerId);
			syncHostAccess();
		},
		onState: (players, sessionStart, hostId) =>
		{
			state.players = players;
			state.sessionStart = sessionStart;
			state.hostId = hostId;
			syncHostAccess();
			updateSessionTimer(state.sessionStart, layout.setSessionElapsed);
		},
		onTerrainSnapshot: (message) =>
		{
			clientGame.applyTerrainSnapshot(message.terrain, message.terrainVersion);
			clientGame.setTerrainRenderControls(layout.getTerrainRenderSettings());
			clientGame.setMovementTestConfig({
				showPaths: layout.getMovementSettings().debugPaths,
			});
			layout.setStatus(`Terrain synced v${message.terrainVersion}`);
		},
		onWorldSnapshot: (message) =>
		{
			clientGame.applyWorldSnapshot(message);
			layout.setSessionElapsed(message.serverTime);
		},
	});

	void connection;

	layout.onTerrainSettingsChange((nextSettings) =>
	{
		clientGame.setTerrainRenderControls(nextSettings.render);
		clientGame.setMovementTestConfig({
			showPaths: nextSettings.movement.debugPaths,
		});
	});

	clientGame.bind((deltaMs, now) =>
	{
		void deltaMs;
		updateFpsCounter(now, fpsTracker, layout.setFps);
	});
}
