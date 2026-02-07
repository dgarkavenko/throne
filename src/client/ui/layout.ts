type PageLayout = {
  field: HTMLElement | null;
  setStatus: (message: string) => void;
  setSessionElapsed: (elapsedMs: number | null) => void;
  setFps: (fps: number | null) => void;
  setConnected: (isConnected: boolean) => void;
  getTerrainSettings: () => { pointCount: number; spacing: number; showGraphs: boolean };
  onTerrainSettingsChange: (onChange: (settings: { pointCount: number; spacing: number; showGraphs: boolean }) => void) => void;
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return minutes + ':' + paddedSeconds;
}

export function createPageLayout(): PageLayout {
  const field = document.getElementById('field');
  const statusEl = document.getElementById('status');
  const sessionEl = document.getElementById('session');
  const fpsEl = document.getElementById('fps');
  const terrainPointsInput = document.getElementById('terrain-points') as HTMLInputElement | null;
  const terrainSpacingInput = document.getElementById('terrain-spacing') as HTMLInputElement | null;
  const terrainGraphsInput = document.getElementById('terrain-graphs') as HTMLInputElement | null;
  const terrainPointsValue = document.getElementById('terrain-points-value');
  const terrainSpacingValue = document.getElementById('terrain-spacing-value');

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

  const readTerrainSettings = (): { pointCount: number; spacing: number; showGraphs: boolean } => {
    const pointCount = clamp(Number.parseInt(terrainPointsInput?.value || '72', 10), 64, 1024);
    const spacing = clamp(Number.parseInt(terrainSpacingInput?.value || '18', 10), 8, 128);
    const showGraphs = Boolean(terrainGraphsInput?.checked);
    return { pointCount, spacing, showGraphs };
  };

  const syncTerrainLabels = (): void => {
    const settings = readTerrainSettings();
    if (terrainPointsValue) {
      terrainPointsValue.textContent = settings.pointCount.toString();
    }
    if (terrainSpacingValue) {
      terrainSpacingValue.textContent = settings.spacing.toString();
    }
  };

  syncTerrainLabels();

  return {
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
      if (elapsedMs === null) {
        sessionEl.textContent = 'Session: --:--';
        return;
      }
      sessionEl.textContent = formatDuration(elapsedMs);
    },
    setFps(fps) {
      if (!fpsEl) {
        return;
      }
      if (fps === null) {
        fpsEl.textContent = 'FPS: --';
        return;
      }
      fpsEl.textContent = 'FPS: ' + fps;
    },
    setConnected(isConnected) {
      document.body.classList.toggle('connected', isConnected);
    },
    getTerrainSettings() {
      return readTerrainSettings();
    },
    onTerrainSettingsChange(onChange) {
      const notify = () => {
        syncTerrainLabels();
        onChange(readTerrainSettings());
      };
      terrainPointsInput?.addEventListener('input', notify);
      terrainSpacingInput?.addEventListener('input', notify);
      terrainGraphsInput?.addEventListener('change', notify);
    },
  };
}
