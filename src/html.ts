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
      <div id="field"></div>
      <div class="status" id="status">Connecting...</div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
    <script>
      ${clientScript}
    </script>
  </body>
</html>`;
