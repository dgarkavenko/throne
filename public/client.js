import { GameEngine } from './client/engine/game-engine';
import { connectToRoom } from './client/net/connection';
import { createPageLayout } from './client/ui/layout';
const GAME_WIDTH = 1560;
const GAME_HEIGHT = 844;
const COLLIDER_SCALE = 0.9;
const state = {
    playerId: null,
    currentTyping: '',
    sessionStart: null,
    sessionTimerId: null,
    players: [],
};
const fpsTracker = {
    lastSample: performance.now(),
    frames: 0,
};
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
async function startClient() {
    const layout = createPageLayout();
    const engine = new GameEngine({
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        colliderScale: COLLIDER_SCALE,
        uiOffset: { x: 24, y: 24 },
    });
    await engine.init(layout.field);
    const terrainSettings = layout.getTerrainSettings();
    engine.setVoronoiControls(terrainSettings);
    engine.setMovementTestConfig({
        speedScale: terrainSettings.agentSpeedScale,
        timePerProvinceSeconds: terrainSettings.agentTimePerProvinceSeconds,
        lowlandThreshold: terrainSettings.agentLowlandThreshold,
        impassableThreshold: terrainSettings.agentImpassableThreshold,
        elevationPower: terrainSettings.agentElevationPower,
        showPaths: terrainSettings.agentDebugPaths,
    });
    layout.onTerrainSettingsChange((nextSettings) => {
        engine.setVoronoiControls(nextSettings);
        engine.setMovementTestConfig({
            speedScale: nextSettings.agentSpeedScale,
            timePerProvinceSeconds: nextSettings.agentTimePerProvinceSeconds,
            lowlandThreshold: nextSettings.agentLowlandThreshold,
            impassableThreshold: nextSettings.agentImpassableThreshold,
            elevationPower: nextSettings.agentElevationPower,
            showPaths: nextSettings.agentDebugPaths,
        });
    });
    engine.start((deltaMs, now) => {
        void deltaMs;
        updateFpsCounter(now, layout.setFps);
    });
    const connection = connectToRoom({
        onStatus: layout.setStatus,
        onConnected: () => layout.setConnected(true),
        onDisconnected: () => layout.setConnected(false),
        onWelcome: (playerId) => {
            state.playerId = playerId;
        },
        onState: (players, sessionStart) => {
            state.players = players;
            state.sessionStart = sessionStart;
            engine.renderPlayers(players);
            updateSessionTimer(layout.setSessionElapsed);
        },
        onHistory: (messages) => {
            const totalMessages = messages.length;
            messages.forEach((message, index) => {
                if (!message || typeof message.text !== 'string') {
                    return;
                }
                const spawnPosition = engine.getHistorySpawnPosition(index, totalMessages);
                engine.spawnTextBox(message.text, message.color, message.emoji, spawnPosition);
            });
        },
        onLaunch: (message) => {
            engine.spawnTextBox(message.text || '', message.color, message.emoji, engine.getTypingPosition(message.id));
        },
    });
    if (!state.sessionTimerId) {
        state.sessionTimerId = window.setInterval(() => {
            updateSessionTimer(layout.setSessionElapsed);
        }, 1000);
    }
    updateSessionTimer(layout.setSessionElapsed);
    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        if (event.key === 'Backspace') {
            state.currentTyping = state.currentTyping.slice(0, -1);
            connection.sendTyping(state.currentTyping);
            return;
        }
        if (event.key === 'Escape' || event.key === 'Enter') {
            if (event.key === 'Enter' && state.currentTyping.trim()) {
                connection.sendLaunch(state.currentTyping);
            }
            state.currentTyping = '';
            connection.sendTyping(state.currentTyping);
            return;
        }
        if (event.key.length === 1) {
            state.currentTyping += event.key;
            connection.sendTyping(state.currentTyping);
        }
    });
    window.addEventListener('blur', () => {
        // Intentionally keep currentTyping when the tab loses focus.
    });
}
void startClient();
