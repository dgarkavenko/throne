import { clientScript } from './client';

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
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
}
.field-stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}
#field {
  width: 390px;
  height: 844px;
  background: #0b0e12;
  border-radius: 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
#field canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.log-panel {
  width: 280px;
  max-height: 844px;
  background: #0b0e12;
  border-radius: 20px;
  padding: 1rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.log-panel h2 {
  font-size: 1rem;
  margin: 0;
  opacity: 0.8;
}
.log-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
  flex: 1;
  font-size: 0.85rem;
  line-height: 1.4;
  color: #cdd3dc;
}
.log-list li {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 0.4rem 0.6rem;
}
.status {
  font-size: 0.9rem;
  opacity: 0.75;
}
@media (max-width: 480px) {
  body {
    align-items: flex-start;
    padding: 1rem 0;
  }
  #field {
    width: min(100vw, 390px);
    height: min(100vh, 844px);
    border-radius: 20px;
  }
  main {
    flex-direction: column;
    align-items: center;
  }
  .log-panel {
    width: min(90vw, 360px);
    max-height: 320px;
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
      <aside class="log-panel">
        <h2>Activity log</h2>
        <ul class="log-list" id="log"></ul>
      </aside>
      <div class="field-stack">
        <div id="field"></div>
        <div class="status" id="status">Connecting...</div>
      </div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js"></script>
    <script>
      ${clientScript}
    </script>
  </body>
</html>`;
