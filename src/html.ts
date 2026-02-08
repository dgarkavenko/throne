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
.layout {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
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
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  align-items: stretch;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.9;
}
.control-group {
  min-width: 0;
  display: grid;
  gap: 0.55rem;
  padding: 0.65rem 0.7rem 0.75rem;
  border-radius: 12px;
  border: 1px solid #253149;
  background: rgba(10, 14, 22, 0.7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
}
.control-group > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.62rem;
  letter-spacing: 0.2em;
  opacity: 0.8;
}
.control-group > summary::-webkit-details-marker {
  display: none;
}
.control-group > summary::after {
  content: '+';
  font-size: 0.75rem;
  letter-spacing: 0;
  opacity: 0.7;
}
.control-group[open] > summary::after {
  content: '–';
}
.control-group-title {
  font-size: 0.62rem;
  letter-spacing: 0.2em;
  opacity: 0.7;
}
.control {
  min-width: 0;
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
.control input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  padding: 0.45rem 0.55rem;
  border: 1px solid #3f4e6a;
  border-radius: 6px;
  background: #0d1422;
  color: #f5f5f5;
  font-size: 0.82rem;
}
.control.toggle {
  min-width: 0;
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
.control-button {
  width: 100%;
  padding: 0.65rem 0.8rem;
  border: 1px solid #3f4e6a;
  border-radius: 10px;
  background: #0d1422;
  color: #f5f5f5;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
.control-button:hover {
  background: #132033;
  border-color: #4a5e80;
}
.control-button:active {
  transform: translateY(1px);
}
@media (max-width: 480px) {
  body {
    align-items: flex-start;
    padding: 1rem 0;
  }
  .layout {
    flex-direction: column;
    align-items: center;
  }
  .controls {
    width: min(100%, 1560px);
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
  .control-group {
    min-width: 200px;
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
      <div class="layout">
        <div class="controls">
          <button class="control-button" id="terrain-reset" type="button">Reset Settings</button>
          <details class="control-group">
            <summary>Sampling</summary>
            <div class="control">
              <label for="terrain-spacing">Spacing <span id="terrain-spacing-value">32</span></label>
              <input id="terrain-spacing" type="range" min="16" max="128" step="1" value="32" />
            </div>
            <div class="control">
              <label for="terrain-seed">Seed</label>
              <input id="terrain-seed" type="number" min="0" max="4294967295" step="1" value="1337" />
            </div>
          </details>
          <details class="control-group">
            <summary>Water</summary>
            <div class="control">
              <label for="terrain-water-level">Water Level <span id="terrain-water-level-value">-10</span></label>
              <input id="terrain-water-level" type="range" min="-40" max="40" step="1" value="-10" />
            </div>
            <div class="control">
              <label for="terrain-water-roughness">Water Roughness <span id="terrain-water-roughness-value">60</span></label>
              <input id="terrain-water-roughness" type="range" min="0" max="100" step="1" value="60" />
            </div>
            <div class="control">
              <label for="terrain-water-noise-scale">Noise Scale <span id="terrain-water-noise-scale-value">2</span></label>
              <input id="terrain-water-noise-scale" type="range" min="2" max="60" step="1" value="2" />
            </div>
            <div class="control">
              <label for="terrain-water-noise-strength">
                Noise Strength <span id="terrain-water-noise-strength-value">0.00</span>
              </label>
              <input id="terrain-water-noise-strength" type="range" min="0" max="1" step="0.01" value="0" />
            </div>
            <div class="control">
              <label for="terrain-water-noise-octaves">
                Noise Octaves <span id="terrain-water-noise-octaves-value">1</span>
              </label>
              <input id="terrain-water-noise-octaves" type="range" min="1" max="6" step="1" value="1" />
            </div>
            <div class="control">
              <label for="terrain-water-warp-scale">Warp Scale <span id="terrain-water-warp-scale-value">2</span></label>
              <input id="terrain-water-warp-scale" type="range" min="2" max="40" step="1" value="2" />
            </div>
            <div class="control">
              <label for="terrain-water-warp-strength">
                Warp Strength <span id="terrain-water-warp-strength-value">0.70</span>
              </label>
              <input id="terrain-water-warp-strength" type="range" min="0" max="0.8" step="0.01" value="0.7" />
            </div>
          </details>
          <details class="control-group">
            <summary>Rivers</summary>
            <div class="control">
              <label for="terrain-river-density">
                River Density <span id="terrain-river-density-value">1.0</span>
              </label>
              <input id="terrain-river-density" type="range" min="0" max="2" step="0.1" value="1" />
            </div>
            <div class="control">
              <label for="terrain-river-branch-chance">
                Branch Chance <span id="terrain-river-branch-chance-value">0.25</span>
              </label>
              <input id="terrain-river-branch-chance" type="range" min="0" max="1" step="0.05" value="0.25" />
            </div>
            <div class="control">
              <label for="terrain-river-climb-chance">
                Climb Chance <span id="terrain-river-climb-chance-value">0.35</span>
              </label>
              <input id="terrain-river-climb-chance" type="range" min="0" max="1" step="0.05" value="0.35" />
            </div>
          </details>
          <details class="control-group">
            <summary>Land</summary>
            <div class="control">
                <label for="terrain-land-relief">
                  Land Relief <span id="terrain-land-relief-value">0.95</span>
                </label>
                <input id="terrain-land-relief" type="range" min="0" max="1" step="0.05" value="0.95" />
              </div>
              <div class="control">
                <label for="terrain-ridge-strength">
                  Ridge Strength <span id="terrain-ridge-strength-value">0.85</span>
                </label>
                <input id="terrain-ridge-strength" type="range" min="0" max="1" step="0.05" value="0.85" />
              </div>
              <div class="control">
                <label for="terrain-ridge-count">Ridge Count <span id="terrain-ridge-count-value">9</span></label>
                <input id="terrain-ridge-count" type="range" min="1" max="10" step="1" value="9" />
              </div>
              <div class="control">
                <label for="terrain-plateau-strength">
                  Lowland Smoothing <span id="terrain-plateau-strength-value">0.80</span>
                </label>
                <input id="terrain-plateau-strength" type="range" min="0" max="1" step="0.05" value="0.8" />
              </div>
              <div class="control">
                <label for="terrain-ridge-distribution">
                  Ridge Distribution <span id="terrain-ridge-distribution-value">0.80</span>
                </label>
                <input id="terrain-ridge-distribution" type="range" min="0" max="1" step="0.05" value="0.8" />
              </div>
              <div class="control">
                <label for="terrain-ridge-separation">
                  Ridge Separation <span id="terrain-ridge-separation-value">0.95</span>
                </label>
              <input id="terrain-ridge-separation" type="range" min="0" max="1" step="0.05" value="0.95" />
            </div>
              <div class="control">
                <label for="terrain-ridge-continuity">
                  Ridge Continuity <span id="terrain-ridge-continuity-value">0.25</span>
                </label>
                <input id="terrain-ridge-continuity" type="range" min="0" max="1" step="0.05" value="0.25" />
              </div>
              <div class="control">
                <label for="terrain-ridge-continuity-threshold">
                  Ridge Continuity Threshold <span id="terrain-ridge-continuity-threshold-value">0.00</span>
                </label>
                <input
                  id="terrain-ridge-continuity-threshold"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value="0"
                />
              </div>
              <div class="control">
                <label for="terrain-ocean-peak-clamp">
                  Ocean Peak Clamp <span id="terrain-ocean-peak-clamp-value">0.05</span>
                </label>
                <input id="terrain-ocean-peak-clamp" type="range" min="0" max="1" step="0.05" value="0.05" />
              </div>
              <div class="control">
                <label for="terrain-ridge-ocean-clamp">
                  Ridge Ocean Clamp <span id="terrain-ridge-ocean-clamp-value">0.50</span>
                </label>
                <input id="terrain-ridge-ocean-clamp" type="range" min="0" max="1" step="0.05" value="0.5" />
              </div>
              <div class="control">
                <label for="terrain-ridge-width">
                  Ridge Width <span id="terrain-ridge-width-value">1.00</span>
                </label>
                <input id="terrain-ridge-width" type="range" min="0" max="1" step="0.05" value="1" />
              </div>
          </details>
          <details class="control-group">
            <summary>Provinces</summary>
            <div class="control">
              <label for="terrain-province-count">
                Province Count <span id="terrain-province-count-value">8</span>
              </label>
              <input id="terrain-province-count" type="range" min="1" max="32" step="1" value="8" />
            </div>
            <div class="control">
              <label for="terrain-province-border-width">
                Border Width <span id="terrain-province-border-width-value">6.5</span>
              </label>
              <input id="terrain-province-border-width" type="range" min="1" max="24" step="0.5" value="6.5" />
            </div>
            <div class="control toggle">
              <label for="terrain-province-land-borders">
                <input id="terrain-province-land-borders" type="checkbox" checked />
                Land Borders
              </label>
            </div>
            <div class="control toggle">
              <label for="terrain-province-shore-borders">
                <input id="terrain-province-shore-borders" type="checkbox" checked />
                Shore Borders
              </label>
            </div>
          </details>
          <details class="control-group">
            <summary>Intermediate</summary>
            <div class="control">
              <label for="terrain-intermediate-seed">Intermediate Seed</label>
              <input id="terrain-intermediate-seed" type="number" min="0" max="4294967295" step="1" value="1337" />
            </div>
            <div class="control">
              <label for="terrain-intermediate-iterations">
                Intermediate Iterations <span id="terrain-intermediate-iterations-value">6</span>
              </label>
              <input id="terrain-intermediate-iterations" type="range" min="0" max="12" step="1" value="6" />
            </div>
            <div class="control">
              <label for="terrain-intermediate-distance">
                Threshold Distance <span id="terrain-intermediate-distance-value">5</span>
              </label>
              <input id="terrain-intermediate-distance" type="range" min="2" max="20" step="1" value="5" />
            </div>
            <div class="control">
              <label for="terrain-intermediate-rel-magnitude">
                Relative Magnitude <span id="terrain-intermediate-rel-magnitude-value">0.1</span>
              </label>
              <input id="terrain-intermediate-rel-magnitude" type="range" min="0" max="2" step="0.1" value="0.1" />
            </div>
            <div class="control">
              <label for="terrain-intermediate-abs-magnitude">
                Absolute Magnitude <span id="terrain-intermediate-abs-magnitude-value">2</span>
              </label>
              <input id="terrain-intermediate-abs-magnitude" type="range" min="0" max="10" step="0.1" value="2" />
            </div>
          </details>
          <details class="control-group" open>
            <summary>Overlay</summary>
            <div class="control toggle">
              <label for="terrain-graph-polygons">
                <input id="terrain-graph-polygons" type="checkbox" />
                Mesh Polygons
              </label>
            </div>
            <div class="control toggle">
              <label for="terrain-graph-dual">
                <input id="terrain-graph-dual" type="checkbox" />
                Mesh Dual
              </label>
            </div>
            <div class="control toggle">
              <label for="terrain-graph-corners">
                <input id="terrain-graph-corners" type="checkbox" />
                Mesh Vertices
              </label>
            </div>
            <div class="control toggle">
              <label for="terrain-graph-centers">
                <input id="terrain-graph-centers" type="checkbox" />
                Mesh Faces
              </label>
            </div>
            <div class="control toggle">
              <label for="terrain-graph-inserted">
                <input id="terrain-graph-inserted" type="checkbox" />
                Inserted Points
              </label>
            </div>
          </details>
        </div>
        <div id="field"></div>
      </div>
      <div class="status" id="status">Connecting...</div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
