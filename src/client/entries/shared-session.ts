import type { PlayerState } from '../../shared/protocol';

export type SessionClientState = {
  playerId: number | null;
  hostId: number | null;
  sessionStart: number | null;
  sessionTimerId: number | null;
  players: PlayerState[];
};

export type FpsTracker = {
  lastSample: number;
  frames: number;
};

export function createSessionClientState(): SessionClientState {
  return {
    playerId: null,
    hostId: null,
    sessionStart: null,
    sessionTimerId: null,
    players: [],
  };
}

export function createFpsTracker(now = performance.now()): FpsTracker {
  return {
    lastSample: now,
    frames: 0,
  };
}

export function updateSessionTimer(
  sessionStart: number | null,
  setSessionElapsed: (elapsedMs: number | null) => void
): void {
  if (!sessionStart) {
    setSessionElapsed(null);
    return;
  }
  setSessionElapsed(Date.now() - sessionStart);
}

export function setRoomRouteLink(anchorId: string, routePath: '/game' | '/editor'): void {
  const link = document.getElementById(anchorId) as HTMLAnchorElement | null;
  if (!link) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  link.href = roomId ? `${routePath}?room=${encodeURIComponent(roomId)}` : routePath;
}

export function updateFpsCounter(
  now: number,
  tracker: FpsTracker,
  setFps: (fps: number | null) => void,
  sampleWindowMs = 500
): void {
  tracker.frames += 1;
  const elapsed = now - tracker.lastSample;
  if (elapsed < sampleWindowMs) {
    return;
  }
  const fps = Math.round((tracker.frames * 1000) / elapsed);
  setFps(fps);
  tracker.frames = 0;
  tracker.lastSample = now;
}
