import { GameEngine } from './client/engine/game-engine';
import { connectToRoom } from './client/net/connection';
import { createPageLayout } from './client/ui/layout';
import type { AgentsConfig, PlayerState } from './client/types';

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

function updateFpsCounter(now: number, setFps: (fps: number | null) => void): void
{
	fpsTracker.frames += 1;
	const elapsed = now - fpsTracker.lastSample;
	if (elapsed < 500)
	{
		return;
	}
	const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
	setFps(fps);
	fpsTracker.frames = 0;
	fpsTracker.lastSample = now;
}

function updateSessionTimer(setSessionElapsed: (elapsedMs: number | null) => void): void
{
	if (!state.sessionStart)
	{
		setSessionElapsed(null);
		return;
	}
	setSessionElapsed(Date.now() - state.sessionStart);
}

function toAuthoritativeAgents(settings: {
	timePerFaceSeconds: number;
	lowlandThreshold: number;
	impassableThreshold: number;
	elevationPower: number;
	elevationGainK: number;
	riverPenalty: number;
}): AgentsConfig
{
	return {
		timePerFaceSeconds: settings.timePerFaceSeconds,
		lowlandThreshold: settings.lowlandThreshold,
		impassableThreshold: settings.impassableThreshold,
		elevationPower: settings.elevationPower,
		elevationGainK: settings.elevationGainK,
		riverPenalty: settings.riverPenalty,
	};
}

function toAgentsKey(settings: AgentsConfig): string
{
	return JSON.stringify([
		settings.timePerFaceSeconds,
		settings.lowlandThreshold,
		settings.impassableThreshold,
		settings.elevationPower,
		settings.elevationGainK,
		settings.riverPenalty,
	]);
}

async function startClientGame(): Promise<void>
{
	const layout = createPageLayout();
	const editorLink = document.getElementById('editor-link') as HTMLAnchorElement | null;

	if (editorLink)
	{
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

	const nextActorCommandIdByActor = new Map<string, number>();
	const nextCommandId = (actorId: string): number =>
	{
		const next = (nextActorCommandIdByActor.get(actorId) ?? 0) + 1;
		nextActorCommandIdByActor.set(actorId, next);
		return next;
	};

	let lastPublishedAgentsKey: string | null = null;
	const syncHostAccess = (): void =>
	{
		const hasSessionIdentity = Boolean(state.playerId) && Boolean(state.hostId);
		layout.setSettingsVisible(hasSessionIdentity);
		if (!hasSessionIdentity)
		{
			layout.setAgentControlsEnabled(false);
			return;
		}
		const isHost = state.playerId === state.hostId;
		layout.setAgentControlsEnabled(isHost);
	};

	const connection = connectToRoom({
		onStatus: layout.setStatus,
		onConnected: () => layout.setConnected(true),
		onDisconnected: () => layout.setConnected(false),
		onWelcome: (playerId) =>
		{
			console.log("client:onWelcome");

			state.playerId = playerId;
			engine.setLocalPlayerId(playerId);
			syncHostAccess();
		},
		onState: (players, sessionStart, hostId) =>
		{
			console.log("client:onState");

			state.players = players;
			state.sessionStart = sessionStart;
			state.hostId = hostId;
			syncHostAccess();
			updateSessionTimer(layout.setSessionElapsed);
		},
		onTerrainSnapshot: (message) =>
		{
			//TODO::split terrain snapshot and render controls and game settings (setMovementTestConfig)
			console.log("client:onTerrainSnapshot");

			const authoritativeAgents = message.terrain.movement;
			layout.setAgentSettings({
				timePerFaceSeconds: authoritativeAgents.timePerFaceSeconds,
				lowlandThreshold: authoritativeAgents.lowlandThreshold,
				impassableThreshold: authoritativeAgents.impassableThreshold,
				elevationPower: authoritativeAgents.elevationPower,
				elevationGainK: authoritativeAgents.elevationGainK,
				riverPenalty: authoritativeAgents.riverPenalty,
			});
			lastPublishedAgentsKey = toAgentsKey(authoritativeAgents);

			engine.applyTerrainSnapshot(message.terrain, message.terrainVersion);
			engine.setTerrainRenderControls(layout.getTerrainRenderSettings());
			engine.setMovementTestConfig({
				showPaths: layout.getMovementSettings().debugPaths,
			});
			layout.setStatus(`Terrain synced v${message.terrainVersion}`);
		},
		onActorCommand: (message) =>
		{
			engine.applyActorCommand(message);
		},
		onWorldSnapshot: (message) =>
		{
			console.log("client:onWorldSnapshot");
			engine.applyWorldSnapshot(message);
			layout.setSessionElapsed(message.serverTime);
		},
		onActorReject: (message) =>
		{
			layout.setStatus(`Move rejected: ${message.reason}`);
		},
	});

	layout.onTerrainSettingsChange((nextSettings) =>
	{
		engine.setTerrainRenderControls(nextSettings.render);
		engine.setMovementTestConfig({
			showPaths: nextSettings.movement.debugPaths,
		});

		if (!state.playerId || !state.hostId || state.playerId !== state.hostId)
		{
			return;
		}
		const authoritative = toAuthoritativeAgents(nextSettings.movement);
		const nextKey = toAgentsKey(authoritative);
		if (nextKey === lastPublishedAgentsKey)
		{
			return;
		}
		lastPublishedAgentsKey = nextKey;
		connection.publishAgentsConfig(authoritative);
	});

	let unbind = engine.bindActorMoveCommandReplication((actorId, targetFace) =>
	{
		const terrainVersion = engine.getTerrainVersion();
		const commandId = nextCommandId(actorId);
		connection.sendActorMove(actorId, targetFace, commandId, terrainVersion);
	});

	engine.bindAndStart((deltaMs, now) =>
	{
		void deltaMs;

		fpsTracker.frames += 1;
		const elapsed = now - fpsTracker.lastSample;
		if (elapsed >= 500)
		{
			const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
			layout.setFps(fps);
			fpsTracker.frames = 0;
			fpsTracker.lastSample = now;
		}
	});	
}

void startClientGame();
