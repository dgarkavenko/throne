const styles = `
:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  min-height: 100vh;
  background: #050607;
  color: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}
main {
  display: grid;
  gap: 1rem;
  justify-items: center;
}
.session {
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  opacity: 0.85;
  text-transform: uppercase;
}
.fps {
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  opacity: 0.7;
  text-transform: uppercase;
}
#field {
  width: 1560px;
  height: 844px;
  background: linear-gradient(145deg, #101a2c 0%, #1a1f3a 48%, #2f1824 100%);
  border-radius: 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
#field canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.status {
  font-size: 0.9rem;
  opacity: 0.75;
}
.controls {
  width: min(100%, 1560px);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  align-items: center;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.9;
}
.control {
  min-width: 220px;
  display: grid;
  gap: 0.35rem;
}
.control label {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
.control input[type="range"] {
  width: 100%;
  accent-color: #a7c28f;
}
.control.toggle {
  min-width: 180px;
  align-items: center;
}
.control.toggle label {
  justify-content: flex-start;
  align-items: center;
  gap: 0.5rem;
}
.control.toggle input[type="checkbox"] {
  accent-color: #a7c28f;
  width: 1rem;
  height: 1rem;
}
@media (max-width: 480px) {
  body {
    align-items: flex-start;
    padding: 1rem 0;
  }
  #field {
    width: min(100vw, 1560px);
    height: min(100vh, 844px);
    border-radius: 20px;
  }
}
`;

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Throne</title>
    <style>
      ${styles}
    </style>
  </head>
  <body>
    <main>
      <div class="session" id="session">Session: --:--</div>
      <div class="fps" id="fps">FPS: --</div>
      <div class="controls">
        <div class="control">
          <label for="terrain-points">Points <span id="terrain-points-value">72</span></label>
          <input id="terrain-points" type="range" min="64" max="1024" step="1" value="72" />
        </div>
        <div class="control">
          <label for="terrain-spacing">Spacing <span id="terrain-spacing-value">18</span></label>
          <input id="terrain-spacing" type="range" min="8" max="128" step="1" value="18" />
        </div>
        <div class="control toggle">
          <label for="terrain-graphs">
            <input id="terrain-graphs" type="checkbox" />
            Show Graphs
          </label>
        </div>
      </div>
      <div id="field"></div>
      <div class="status" id="status">Connecting...</div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
    <script src="/client.js"></script>
  </body>
</html>`;
