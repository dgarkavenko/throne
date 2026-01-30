import { clientScript } from './client';

const styles = `
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  min-height: 100vh;
  background: #0f1115;
  color: #f5f5f5;
}
main {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}
header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.controls input {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: #1a1d24;
  color: inherit;
}
.controls button {
  padding: 0.5rem 0.9rem;
  border-radius: 0.5rem;
  border: none;
  background: #3b82f6;
  color: white;
  cursor: pointer;
  font-weight: 600;
}
.controls button.secondary {
  background: #272b35;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.status {
  font-size: 0.9rem;
  opacity: 0.8;
}
body.connected .setup-controls,
body.connected .share-controls,
body.connected .hint {
  display: none;
}
#field {
  position: relative;
  overflow: hidden;
  background: radial-gradient(circle at top left, #1f2937, #0f1115 50%);
  cursor: none;
}
#field canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.hint {
  font-size: 0.85rem;
  opacity: 0.7;
}
.chat-controls input {
  min-width: 16rem;
}
@media (max-width: 720px) {
  header {
    flex-direction: column;
    align-items: flex-start;
  }
}
body {
  cursor: none;
}
`;

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mouse Room</title>
    <style>
      ${styles}
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Mouse Room</h1>
          <div class="hint">Host a room, then share the code so others can join.</div>
        </div>
        <div class="controls setup-controls">
          <input id="room" placeholder="Room code" />
          <button id="host">Host room</button>
          <button id="join" class="secondary">Join room</button>
        </div>
        <div class="controls share-controls">
          <input id="share-link" readonly placeholder="Share link" />
          <button id="copy" class="secondary">Copy link</button>
        </div>
        <div class="status-row">
          <div class="status" id="status">Not connected</div>
          <button id="leave" class="secondary" disabled>Leave</button>
        </div>
        <div class="controls chat-controls">
          <input id="message-input" placeholder="Type a message" disabled />
        </div>
      </header>
      <section id="field">
        <canvas id="scene"></canvas>
      </section>
    </main>

    <script src="https://unpkg.com/planck-js@0.3.0/dist/planck.min.js"></script>
    <script>
      ${clientScript}
    </script>
  </body>
</html>`;
