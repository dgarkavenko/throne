import { GameEngine } from './client/engine/game-engine';
import { connectToRoom } from './client/net/connection';
const GAME_WIDTH = 1560;
const GAME_HEIGHT = 844;
const state = {
    playerId: null,
    sessionStart: null,
    sessionTimerId: null,
    players: [],
};
const fpsTracker = {
    lastSample: performance.now(),
    frames: 0,
};
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
function updateFpsCounter(now, setFps) {
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
function updateSessionTimer(setSessionElapsed) {
    if (!state.sessionStart) {
        setSessionElapsed(null);
        return;
    }
    setSessionElapsed(Date.now() - state.sessionStart);
}
async function startClientGame() {
    const field = document.getElementById('field');
    const statusEl = document.getElementById('status');
    const sessionEl = document.getElementById('session');
    const fpsEl = document.getElementById('fps');
    const editorLink = document.getElementById('editor-link');
    if (editorLink) {
        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room');
        editorLink.href = roomId ? `/editor?room=${encodeURIComponent(roomId)}` : '/editor';
    }
    const layout = {
        field,
        setStatus(message) {
            if (!statusEl) {
                return;
            }
            statusEl.textContent = message;
        },
        setSessionElapsed(elapsedMs) {
            if (!sessionEl) {
                return;
            }
            sessionEl.textContent = elapsedMs === null ? 'Session: --:--' : `Session: ${formatDuration(elapsedMs)}`;
        },
        setFps(fps) {
            if (!fpsEl) {
                return;
            }
            fpsEl.textContent = fps === null ? 'FPS: --' : `FPS: ${fps}`;
        },
        setConnected(isConnected) {
            document.body.classList.toggle('connected', isConnected);
        },
    };
    const engine = new GameEngine({
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        colliderScale: 0.9,
        uiOffset: { x: 24, y: 24 },
        autoGenerateTerrain: false,
    });
    await engine.init(layout.field);
    engine.setMovementTestConfig({
        showPaths: false,
    });
    const nextActorCommandIdByActor = new Map();
    const nextCommandId = (actorId) => {
        const next = (nextActorCommandIdByActor.get(actorId) ?? 0) + 1;
        nextActorCommandIdByActor.set(actorId, next);
        return next;
    };
    const connection = connectToRoom({
        onStatus: layout.setStatus,
        onConnected: () => layout.setConnected(true),
        onDisconnected: () => layout.setConnected(false),
        onWelcome: (playerId) => {
            state.playerId = playerId;
            engine.setLocalPlayerId(playerId);
        },
        onState: (players, sessionStart) => {
            state.players = players;
            state.sessionStart = sessionStart;
            engine.renderPlayers(players);
            updateSessionTimer(layout.setSessionElapsed);
        },
        onTerrainSnapshot: (message) => {
            engine.applyTerrainSnapshot(message.terrain, message.terrainVersion);
            layout.setStatus(`Terrain synced v${message.terrainVersion}`);
        },
        onActorCommand: (message) => {
            engine.applyActorCommand(message);
        },
        onWorldSnapshot: (message) => {
            engine.applyWorldSnapshot(message);
        },
        onActorReject: (message) => {
            layout.setStatus(`Move rejected: ${message.reason}`);
        },
    });
    engine.onActorMoveCommand((actorId, targetFace) => {
        const terrainVersion = engine.getTerrainVersion();
        const commandId = nextCommandId(actorId);
        connection.sendActorMove(actorId, targetFace, commandId, terrainVersion);
    });
    engine.start((deltaMs, now) => {
        void deltaMs;
        updateFpsCounter(now, layout.setFps);
    });
    if (!state.sessionTimerId) {
        state.sessionTimerId = window.setInterval(() => {
            updateSessionTimer(layout.setSessionElapsed);
        }, 1000);
    }
    updateSessionTimer(layout.setSessionElapsed);
}
void startClientGame();
